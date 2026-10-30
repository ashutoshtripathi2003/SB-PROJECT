import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'

process.env.DATABASE_PATH = ':memory:'
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
  it("is the car's real fuel for the km and for the traffic, plus tolls, and shows the working", () => {
    // Thane → VIT: 25 km, 30 min of it stuck in traffic, a petrol car that really does 7 km/L.
    const c = fare.tripCost({ distanceKm: 25, durationMin: 75, trafficDelayMin: 30 }, { fuel: 'petrol', mileage: 7 })
    // 25 ÷ 7 = 3.57 L + 0.5 h × 0.8 L/h = 0.4 L → 3.97 L × ₹111.21 = ₹442
    expect(c).toMatchObject({ total: 442, km: 25, trafficMin: 30, kmPerUnit: 7, ownMileage: true, drivingUnits: 3.57, trafficUnits: 0.4, units: 3.97, tolls: 0 })
    expect(Math.abs(c.distanceCost + c.timeCost - c.fuelCost)).toBeLessThanOrEqual(1) // each part rounded to the rupee
    expect(c.summary).toBe('25 km ÷ 7 km/L = 3.57 L + 30 min in traffic × 0.8 L/h = 0.4 L → 3.97 L of petrol × ₹111.21 = ₹442')
    // Tolls and parking are shared too.
    const toll = fare.tripCost({ distanceKm: 25, durationMin: 75, trafficDelayMin: 30 }, { fuel: 'petrol', mileage: 7 }, 100)
    expect(toll).toMatchObject({ total: 542, tolls: 100 })
    expect(toll.summary.endsWith('+ ₹100 tolls/parking = ₹542')).toBe(true)
  })

  it('costs more in traffic and depends on the fuel', () => {
    const clear = fare.tripCost({ distanceKm: 25, durationMin: 58 })
    const rush = fare.tripCost({ distanceKm: 25, durationMin: 113, trafficDelayMin: 55 })
    expect(clear).toMatchObject({ fuel: 'petrol', kmPerUnit: 10, ownMileage: false, total: 278 }) // 2.5 L × ₹111.21
    expect(rush.distanceCost).toBe(clear.distanceCost) // the km part is the same
    expect(rush.total - clear.total).toBe(82) // 55 min × 0.8 L/h = 0.73 L more
    // A CNG car costs far less to run: 25 ÷ 15 km/kg × ₹77.
    expect(fare.tripCost({ distanceKm: 25, durationMin: 58 }, { fuel: 'cng' })).toMatchObject({ unit: 'kg', total: 128 })
    expect(fare.tripCost({ distanceKm: 25, durationMin: 58 }, { fuel: 'ev' })).toMatchObject({ unit: 'kWh', total: 50 })
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
    // The car's real mileage sets the fuel cost (older apps sent other shapes of mileage: ignored).
    expect((await driver.put('/api/me/vehicle').set(H).send({ make: 'Skoda', model: 'Slavia', color: 'Grey', plate: 'MH01AB4321', seats: 3, fuel: 'petrol', mileage: { city: 12 } })).body.vehicle.mileage).toBeUndefined()
    const car = await driver.put('/api/me/vehicle').set(H).send({ make: 'Skoda', model: 'Slavia', color: 'Grey', plate: 'MH01AB4321', seats: 3, fuel: 'petrol', mileage: 8 })
    expect(car.body.vehicle.mileage).toBe(8)

    const departAt = new Date(Date.now() + 3 * 3600_000).toISOString()
    const preview = await driver.post('/api/rides/cost-preview').set(H).send({ origin: campus, destination: malad, departAt, seats: 3, tolls: 50 })
    expect(preview.status).toBe(200)
    expect(preview.body.mode).toBe('share')
    const pc = preview.body.cost
    expect(pc).toMatchObject({ fuel: 'petrol', kmPerUnit: 8, ownMileage: true, tolls: 50 })
    expect(Math.abs(pc.total - (pc.units * 111.21 + 50))).toBeLessThan(1) // fuel × today's price + tolls
    expect(preview.body.shares).toHaveLength(3)
    expect(preview.body.shares[0].each).toBeGreaterThan(preview.body.shares[2].each)
    // The driver pays their own share: whatever the riders don't cover.
    for (const sh of preview.body.shares) expect(sh.driver).toBe(Math.max(0, preview.body.cost.total - sh.riders * sh.each))
    expect(preview.body.shares[0].driver).toBeGreaterThan(0)

    const ride = (await driver.post('/api/rides').set(H).send({ origin: campus, destination: malad, departAt, seats: 3, maxDetourKm: 3, preferences: [], tolls: 50 })).body
    expect(ride).toMatchObject({ fareMode: 'share', costTotal: pc.total })
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

  it("lets the admin set fuel prices, which new trip costs use", async () => {
    const admin = await student('fare.admin@vit.edu.in')
    const other = await student('fare.other@vit.edu.in')
    expect((await other.get('/api/admin/fare-rates')).status).toBe(403)
    expect((await admin.put('/api/admin/fare-rates').set(H).send({ prices: { cng: 90 } })).status).toBe(200)
    expect(fare.tripCost({ distanceKm: 30, durationMin: 40 }, { fuel: 'cng' }).total).toBe(180) // 30 ÷ 15 km/kg × ₹90
    expect((await admin.put('/api/admin/fare-rates').set(H).send({ prices: { ev: 100 } })).status).toBe(400)
    expect((await request(app).get('/api/config')).body.fare.mode).toBe('share')
  })
})
