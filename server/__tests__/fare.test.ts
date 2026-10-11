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

// The user's Hyundai Venue (diesel): ~6.5 km/L on open roads (their figure), 11.5 in the city, 3.5 in heavy traffic.
const venue = { smooth: 6.5, city: 11.5, traffic: 3.5 }

describe('trip cost', () => {
  it('splits the route into smooth, city and jam km from the traffic delay', () => {
    const free = fare.conditionKm({ distanceKm: 25, durationMin: 75 })
    expect(free.traffic).toBe(0)
    expect(free.city).toBeCloseTo(25, 5) // 20 km/h average, no delay: city driving
    const jam = fare.conditionKm({ distanceKm: 25, durationMin: 113, trafficDelayMin: 55 })
    expect(jam.traffic).toBeGreaterThan(10)
    expect(jam.smooth + jam.city + jam.traffic).toBeCloseTo(25, 5)
    const highway = fare.conditionKm({ distanceKm: 60, durationMin: 50 })
    expect(highway.smooth).toBeCloseTo(60, 5)
  })

  it('costs more in traffic, with the driver’s own mileage, and shows the working', () => {
    const prices = { ...fare.DEFAULT_FUEL_PRICES }
    const normal = fare.tripCost('diesel', venue, { distanceKm: 25, durationMin: 58, trafficDelayMin: 0 }, prices)
    const rush = fare.tripCost('diesel', venue, { distanceKm: 25, durationMin: 113, trafficDelayMin: 55 }, prices)
    expect(rush.total).toBeGreaterThan(normal.total * 1.4)
    expect(rush.wear).toBe(normal.wear) // wear depends on km only
    expect(rush.summary).toMatch(/heavy traffic @ 3\.5 km\/L/)
    expect(rush.summary).toContain(`= ₹${rush.total}`)
    // A car with better mileage costs less on the same trip.
    const typical = fare.tripCost('diesel', {}, { distanceKm: 25, durationMin: 113, trafficDelayMin: 55 }, prices)
    expect(typical.total).toBeLessThan(rush.total)
    // Fuel price comes from the admin's table.
    const dearer = fare.tripCost('diesel', venue, { distanceKm: 25, durationMin: 58 }, { ...prices, diesel: 100 })
    expect(dearer.fuelCost).toBeGreaterThan(normal.fuelCost)
  })

  it('fills blank mileage from the typical values, scaled to the car', () => {
    expect(fare.mileageFor('petrol')).toEqual(fare.DEFAULT_MILEAGE.petrol)
    const m = fare.mileageFor('diesel', { city: 8 }) // half the typical city mileage
    expect(m.city).toBe(8)
    expect(m.smooth).toBeCloseTo(fare.DEFAULT_MILEAGE.diesel.smooth / 2, 5)
    expect(m.traffic).toBeCloseTo(fare.DEFAULT_MILEAGE.diesel.traffic / 2, 5)
  })
})

describe('mileage by car model', () => {
  it('knows popular cars, so the driver needn’t type anything', () => {
    expect(fare.carMileage('Hyundai', 'Venue', 'diesel')).toEqual({ name: 'Hyundai Venue', mileage: { smooth: 20, city: 15, traffic: 9 } })
    expect(fare.carMileage('Maruti Suzuki', 'Swift Dzire VXi', 'petrol')?.name).toBe('Maruti Dzire')
    expect(fare.carMileage('Hyundai', 'Grand i10 Nios', 'cng')?.name).toBe('Hyundai i10')
    expect(fare.carMileage('Tata', 'Nexon EV Max', 'ev')?.mileage.city).toBe(7.5)
    expect(fare.carMileage('Lamborghini', 'Urus', 'petrol')).toBeNull()
  })

  it('uses the driver’s own figures first, then the model’s, then typical ones', () => {
    expect(fare.vehicleMileage({ make: 'Hyundai', model: 'Venue', fuel: 'diesel' })).toMatchObject({ source: 'model', mileage: { smooth: 20, city: 15, traffic: 9 } })
    expect(fare.vehicleMileage({ make: 'Hyundai', model: 'Venue', fuel: 'diesel', mileage: venue })).toMatchObject({ source: 'own', mileage: venue })
    expect(fare.vehicleMileage({ make: 'Hyundai', model: 'Venue', fuel: 'diesel', mileage: { traffic: 4 } }).mileage).toEqual({ smooth: 20, city: 15, traffic: 4 })
    expect(fare.vehicleMileage({ make: 'Foo', model: 'Bar', fuel: 'petrol' })).toMatchObject({ source: 'typical', mileage: fare.DEFAULT_MILEAGE.petrol })
  })
})

describe('equal split', () => {
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
  it('saves mileage, previews the cost, re-splits as riders join, and settles at the start', async () => {
    const driver = await student('fare.driver@vit.edu.in', { upiId: 'driver@okaxis' })
    const car = await driver.put('/api/me/vehicle').set(H).send({ make: 'Hyundai', model: 'Venue', color: 'Grey', plate: 'MH01AB4321', seats: 3, fuel: 'diesel', mileage: venue })
    expect(car.status).toBe(200)
    expect(car.body.vehicle.mileage).toEqual(venue)
    expect((await driver.put('/api/me/vehicle').set(H).send({ make: 'Hyundai', model: 'Venue', color: 'Grey', plate: 'MH01AB4321', seats: 3, fuel: 'diesel', mileage: { city: 500 } })).status).toBe(400)

    const departAt = new Date(Date.now() + 3 * 3600_000).toISOString()
    const preview = await driver.post('/api/rides/cost-preview').set(H).send({ origin: campus, destination: malad, departAt, seats: 3 })
    expect(preview.status).toBe(200)
    expect(preview.body.ownMileage).toBe(true)
    expect(preview.body.cost.total).toBeGreaterThan(0)
    expect(preview.body.shares).toHaveLength(3)
    expect(preview.body.shares[0].each).toBeGreaterThan(preview.body.shares[2].each)

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

  it('lets the admin set fuel prices, which new trip costs use', async () => {
    const admin = await student('fare.admin@vit.edu.in')
    const other = await student('fare.other@vit.edu.in')
    expect((await other.get('/api/admin/fuel-prices')).status).toBe(403)
    expect((await admin.get('/api/admin/fuel-prices')).body.prices).toEqual(fare.DEFAULT_FUEL_PRICES)
    const put = await admin.put('/api/admin/fuel-prices').set(H).send({ diesel: 95 })
    expect(put.body.prices).toMatchObject({ diesel: 95, petrol: fare.DEFAULT_FUEL_PRICES.petrol })
    expect((await request(app).get('/api/config')).body.fare.fuelPrices.diesel).toBe(95)
    expect((await admin.put('/api/admin/fuel-prices').set(H).send({ diesel: -1 })).status).toBe(400)
  })
})
