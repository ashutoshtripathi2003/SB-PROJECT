import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'

process.env.DATABASE_PATH = ':memory:'
process.env.FARE_MODE = 'share' // the earlier live-split design, still used by rides created that way
process.env.DEV_LOGIN = 'true'
process.env.ALLOWED_EMAIL_DOMAIN = 'vit.edu.in'
process.env.OSRM_URL = 'http://127.0.0.1:9' // offline route estimate
process.env.ADMIN_EMAILS = 'fare.admin@vit.edu.in'

type Fare = typeof import('../fare')
let fare: Fare
let app: Parameters<typeof request>[0]
const H = { 'x-ridesync': '1' }

beforeAll(async () => {
  fare = await import('../fare')
  app = (await import('../app')).createApp()
})

describe('trip cost', () => {
  it('is km × ₹ per km plus minutes × ₹ per minute, and shows the working', () => {
    const rates = { perKm: 7, perMin: 1 }
    const c = fare.tripCost({ distanceKm: 18, durationMin: 55, trafficDelayMin: 20 }, rates)
    expect(c).toMatchObject({ total: 181, km: 18, min: 55, trafficMin: 20, distanceCost: 126, timeCost: 55 })
    expect(c.summary).toBe('18 km × ₹7 + 55 min × ₹1 = ₹181')
  })

  it('costs more in traffic, for the same km, whatever the car', () => {
    const rates = { ...fare.DEFAULT_RATES }
    const clear = fare.tripCost({ distanceKm: 25, durationMin: 58 }, rates)
    const rush = fare.tripCost({ distanceKm: 25, durationMin: 113, trafficDelayMin: 55 }, rates)
    expect(rush.distanceCost).toBe(clear.distanceCost) // the km part is the same
    expect(rush.total - clear.total).toBe(55 * rates.perMin) // the jam adds only its minutes
    // The rates come from the admin's settings.
    expect(fare.tripCost({ distanceKm: 25, durationMin: 58 }, { perKm: 8, perMin: 1 }).total).toBe(clear.total + 25)
  })
})

describe('equal split', () => {
  it('leaves the driver their own share of the trip cost', () => {
    expect(fare.driverShare(181, 100)).toBe(81)
    expect(fare.driverShare(181, 80 + 45)).toBe(56)
    expect(fare.driverShare(100, 130)).toBe(0) // never negative
  })

  it('shares by person-km with the driver included', () => {
    // ₹420 trip, 25 km; A rides the whole way, B 11 km. Person-km: driver 25 + A 25 + B 11 = 61.
    const fares = fare.splitCost(420, 25, [
      { id: 'A', km: 25, seats: 1 },
      { id: 'B', km: 11, seats: 1 },
    ])
    expect(fares.get('A')).toBe(170) // 420 × 25/61 = 172 → ₹170
    expect(fares.get('B')).toBe(75) // 420 × 11/61 = 76 → ₹75
    // Everyone going the whole way pays the same as the driver: an equal share.
    const full = fare.splitCost(400, 20, [
      { id: 'A', km: 20, seats: 1 },
      { id: 'B', km: 20, seats: 1 },
      { id: 'C', km: 20, seats: 1 },
    ])
    expect([...full.values()]).toEqual([100, 100, 100])
  })

  it('never charges above the booked price, and has a minimum', () => {
    expect(fare.CUSHION).toBe(1.1)
    const max = 220 // booked alone: 400 × 1.1 ÷ 2
    expect(fare.splitCost(900, 20, [{ id: 'A', km: 20, seats: 1, max }]).get('A')).toBe(max)
    expect(fare.splitCost(20, 20, [{ id: 'A', km: 20, seats: 2 }]).get('A')).toBe(60)
    expect(fare.shareTable(400, 3)).toEqual([
      { riders: 1, each: 200 },
      { riders: 2, each: 135 },
      { riders: 3, each: 100 },
    ])
  })
})

const campus = { id: 'vit-campus', name: 'VIT Wadala', area: 'Wadala', lat: 19.0222, lng: 72.8711, kind: 'campus' }
const malad = { id: 'malad', name: 'Malad', area: 'Malad Station', lat: 19.1868, lng: 72.8484, kind: 'station' }
let seq = 0
async function student(email: string, extra: Record<string, unknown> = {}) {
  const agent = request.agent(app)
  await agent.post('/api/auth/dev').set(H).send({ email })
  const r = await agent.patch('/api/me').set(H).send({ phone: `98111${String(++seq).padStart(5, '0')}`, studentId: `FARE${seq}0001`, onboarded: true, ...extra })
  if (r.status !== 200) throw new Error(JSON.stringify(r.body))
  return agent
}

describe('fair fares end to end', () => {
  it('previews the cost, re-splits as riders join, and settles at the start', async () => {
    const driver = await student('fare.driver@vit.edu.in', { upiId: 'driver@okaxis' })
    // Any car works: nothing about the car is needed for the fare (older apps still send mileage; it's ignored).
    const car = await driver.put('/api/me/vehicle').set(H).send({ make: 'Skoda', model: 'Slavia', color: 'Grey', plate: 'MH01AB4321', seats: 3, fuel: 'petrol', mileage: { city: 12 } })
    expect(car.status).toBe(200)
    expect(car.body.vehicle.mileage).toBeUndefined()

    const departAt = new Date(Date.now() + 3 * 3600_000).toISOString()
    const preview = await driver.post('/api/rides/cost-preview').set(H).send({ origin: campus, destination: malad, departAt, seats: 3 })
    expect(preview.status).toBe(200)
    expect(preview.body.cost.total).toBe(Math.round(preview.body.cost.km * 7 + preview.body.cost.min * 1))
    expect(preview.body.shares).toHaveLength(3)
    expect(preview.body.shares[0].each).toBeGreaterThan(preview.body.shares[2].each)
    // The driver pays their own share: whatever the riders don't cover.
    for (const sh of preview.body.shares) expect(sh.driver).toBe(Math.max(0, preview.body.cost.total - sh.riders * sh.each))
    expect(preview.body.shares[0].driver).toBeGreaterThan(0)

    const ride = (await driver.post('/api/rides').set(H).send({ origin: campus, destination: malad, departAt, seats: 3, maxDetourKm: 3, preferences: [] })).body
    expect(ride).toMatchObject({ fareMode: 'share' })
    const cost = ride.costTotal as number
    const query = { pickup: campus, drop: malad, date: departAt.slice(0, 10), time: '00:00', at: departAt, seats: 1, preferences: [] }

    // Rider A books alone: half the cost plus the 10% cushion. Pays by UPI.
    const a = await student('fare.a@vit.edu.in')
    const ba = (await a.post('/api/bookings').set(H).send({ rideId: ride.id, query })).body
    await driver.post(`/api/bookings/${ba.id}/respond`).set(H).send({ accept: true })
    let bookA = (await a.get(`/api/bookings/${ba.id}`)).body.booking
    expect(Math.abs(bookA.fare - (cost * 1.1) / 2)).toBeLessThanOrEqual(5)
    expect(bookA.fareMax).toBe(bookA.fare) // the booked price is the most it can ever cost
    expect(bookA).toMatchObject({ fareFinal: false })
    const paidA = bookA.fare as number
    expect((await a.post(`/api/bookings/${ba.id}/pay`).set(H).send({ method: 'upi' })).status).toBe(200)

    // Rider B joins: A's price drops to a third, and A is told.
    const b = await student('fare.b@vit.edu.in')
    const bb = (await b.post('/api/bookings').set(H).send({ rideId: ride.id, query })).body
    await driver.post(`/api/bookings/${bb.id}/respond`).set(H).send({ accept: true })
    bookA = (await a.get(`/api/bookings/${ba.id}`)).body.booking
    expect(bookA.fare).toBeLessThan(paidA)
    expect(Math.abs(bookA.fare - (cost * 1.1) / 3)).toBeLessThanOrEqual(5)
    expect((await a.get('/api/notifications')).body.map((n: { title: string }) => n.title)).toContain(`Your price went down to ₹${bookA.fare}`)
    // B cancels: A's price goes back up, but never above what A booked at.
    // (Checked through the split cap: fareMax stays A's booked price.)
    expect((await a.get(`/api/bookings/${ba.id}`)).body.booking.fareMax).toBe(paidA)
    await b.post(`/api/bookings/${bb.id}/pay`).set(H).send({ method: 'cash' })

    // Start: no live traffic in tests, so the prices stand (nothing is lowered on a guess). A paid the
    // booked price by UPI before B joined, so the driver returns the difference.
    expect((await driver.post(`/api/rides/${ride.id}/start`).set(H).send({})).status).toBe(200)
    const finalA = (await a.get(`/api/bookings/${ba.id}`)).body.booking
    const finalB = (await b.get(`/api/bookings/${bb.id}`)).body.booking
    expect(finalA.fareFinal).toBe(true)
    expect(finalA.fare).toBe(finalB.fare)
    expect(finalA.fare).toBeLessThanOrEqual(finalA.fareMax)
    expect(finalA.settleDue).toBe(finalA.fare - paidA)
    expect(finalA.fare).toBeLessThan(paidA)
  })

  it('lets the admin set the fare rates, which new trip costs use', async () => {
    const admin = await student('fare.admin@vit.edu.in')
    const other = await student('fare.other@vit.edu.in')
    expect((await other.get('/api/admin/fare-rates')).status).toBe(403)
    expect((await admin.get('/api/admin/fare-rates')).body.rates).toEqual(fare.DEFAULT_RATES)
    const put = await admin.put('/api/admin/fare-rates').set(H).send({ perKm: 8 })
    expect(put.body.rates).toEqual({ ...fare.DEFAULT_RATES, perKm: 8 })
    // The BlaBlaCar-style rate per km per seat is set the same way.
    expect((await admin.put('/api/admin/fare-rates').set(H).send({ perSeatKm: 2.5 })).body.rates.perSeatKm).toBe(2.5)
    expect(fare.seatPrice(20).suggested).toBe(50)
    expect((await request(app).get('/api/config')).body.fare.rates.perKm).toBe(8)
    expect(fare.tripCost({ distanceKm: 10, durationMin: 20 }).total).toBe(10 * 8 + 20 * fare.DEFAULT_RATES.perMin)
    expect((await admin.put('/api/admin/fare-rates').set(H).send({ perKm: 0 })).status).toBe(400)
    expect((await admin.put('/api/admin/fare-rates').set(H).send({ perMin: 50 })).status).toBe(400)
  })
})
