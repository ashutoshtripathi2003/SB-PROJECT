import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'

process.env.DATABASE_PATH = ':memory:'
process.env.FARE_MODE = 'seat' // the BlaBlaCar-style price per seat
process.env.DEV_LOGIN = 'true'
process.env.ALLOWED_EMAIL_DOMAIN = 'vit.edu.in'
process.env.OSRM_URL = 'http://127.0.0.1:9' // offline route estimate

type Fare = typeof import('../fare')
let fare: Fare
let app: Parameters<typeof request>[0]
const H = { 'x-ridesync': '1' }

beforeAll(async () => {
  fare = await import('../fare')
  app = (await import('../app')).createApp()
})

describe('seat price (BlaBlaCar-style)', () => {
  it('suggests distance × ₹ per km a seat, and lets the driver choose half to one and a half times it', () => {
    expect(fare.fareMode()).toBe('seat')
    expect(fare.seatPrice(25, 2)).toEqual({ suggested: 50, min: 30, max: 75, perSeatKm: 2 })
    expect(fare.seatPrice(100, 2)).toEqual({ suggested: 200, min: 100, max: 300, perSeatKm: 2 })
    // Short trips never go below ₹30 a seat.
    expect(fare.seatPrice(4, 2)).toEqual({ suggested: 30, min: 30, max: 45, perSeatKm: 2 })
    // By default the rate follows the petrol price: ₹111.21 ÷ 10 km/L (city traffic) ÷ 4 people = ₹2.80.
    expect(fare.seatPrice(25)).toEqual({ suggested: 70, min: 35, max: 105, perSeatKm: 2.8 })
    // The admin's rate is used.
    expect(fare.seatPrice(25, 3).suggested).toBe(75)
  })
})

const campus = { id: 'vit-campus', name: 'VIT Wadala', area: 'Wadala', lat: 19.0222, lng: 72.8711, kind: 'campus' }
const malad = { id: 'malad', name: 'Malad', area: 'Malad Station', lat: 19.1868, lng: 72.8484, kind: 'station' }
const midway = { id: 'midway', name: 'Midway', area: 'Santacruz', lat: 19.1045, lng: 72.8598, kind: 'station' } // half-way along the route
let seq = 0
async function student(email: string) {
  const agent = request.agent(app)
  await agent.post('/api/auth/dev').set(H).send({ email })
  const r = await agent.patch('/api/me').set(H).send({ phone: `98333${String(++seq).padStart(5, '0')}`, studentId: `SEAT${seq}0001`, onboarded: true, upiId: 'driver@okaxis' })
  if (r.status !== 200) throw new Error(JSON.stringify(r.body))
  return agent
}

describe('offering and booking at a fixed seat price', () => {
  it('lets the driver choose within the range, and riders pay that fixed price for their part of the route', async () => {
    const driver = await student('seat.driver@vit.edu.in')
    // At most 6 rider seats (a 7-seater is the driver + 6).
    expect((await driver.put('/api/me/vehicle').set(H).send({ make: 'Toyota', model: 'Innova', color: 'White', plate: 'MH01AB5555', seats: 7, fuel: 'diesel' })).status).toBe(400)
    await driver.put('/api/me/vehicle').set(H).send({ make: 'Maruti', model: 'Swift', color: 'Red', plate: 'MH01AB5555', seats: 3, fuel: 'petrol' })
    const departAt = new Date(Date.now() + 3 * 3600_000).toISOString()
    const preview = (await driver.post('/api/rides/cost-preview').set(H).send({ origin: campus, destination: malad, departAt, seats: 3 })).body
    expect(preview.mode).toBe('seat')
    expect(preview.seat).toMatchObject(fare.seatPrice(preview.distanceKm))
    expect(preview.seat.rate).toMatchObject({ fuel: 'petrol', price: 111.21, kmPerUnit: 10, ownMileage: false, perSeatKm: 2.8 })

    // Below the range is brought up to its lowest price; a price inside the range is kept as chosen.
    const low = (await driver.post('/api/rides').set(H).send({ origin: campus, destination: malad, departAt, seats: 3, farePerSeat: 5, maxDetourKm: 3, preferences: [] })).body
    expect(low.farePerSeat).toBe(preview.seat.min)
    const later = new Date(Date.now() + 6 * 3600_000).toISOString()
    const chosen = Math.min(preview.seat.max, preview.seat.suggested + 5)
    const ride = (await driver.post('/api/rides').set(H).send({ origin: campus, destination: malad, departAt: later, seats: 3, farePerSeat: chosen, maxDetourKm: 3, preferences: [] })).body
    expect(ride.farePerSeat).toBe(chosen)
    expect(ride.costTotal).toBeUndefined() // no trip-cost formula: the driver's price is the price

    // A rider for the whole route pays the seat price; it doesn't change when others join or at the start.
    const a = await student('seat.a@vit.edu.in')
    const q = { pickup: campus, drop: malad, date: later.slice(0, 10), time: '00:00', at: later, seats: 1, preferences: [] }
    const ba = (await a.post('/api/bookings').set(H).send({ rideId: ride.id, query: q })).body
    expect(ba.fare).toBe(chosen)
    await driver.post(`/api/bookings/${ba.id}/respond`).set(H).send({ accept: true })

    // A rider for part of the way pays less (never under ₹30).
    const b = await student('seat.b@vit.edu.in')
    const qb = { ...q, drop: midway }
    const found = (await b.post('/api/rides/search').set(H).send(qb)).body.results.find((m: { ride: { id: string } }) => m.ride.id === ride.id)
    expect(found).toBeTruthy()
    expect(found.fare).toBeLessThan(chosen)
    expect(found.fare).toBeGreaterThanOrEqual(30)

    expect((await driver.post(`/api/rides/${ride.id}/start`).set(H).send({})).status).toBe(200)
    expect((await a.get(`/api/bookings/${ba.id}`)).body.booking.fare).toBe(chosen)
  })
})

describe("the car's fuel and real mileage, and the rider's old way of travelling", () => {
  it("prices from the driver's own mileage and counts CO₂ only for trips that replace a car or cab", async () => {
    const driver = await student('fuel.driver@vit.edu.in')
    const car = { make: 'Maruti', model: 'Dzire', color: 'Grey', plate: 'MH01AB7777', seats: 3 }
    // Unbelievable mileage is refused; a real one is kept and used.
    expect((await driver.put('/api/me/vehicle').set(H).send({ ...car, fuel: 'petrol', mileage: 80 })).status).toBe(400)
    const me = (await driver.put('/api/me/vehicle').set(H).send({ ...car, fuel: 'petrol', mileage: 6 })).body
    expect(me.vehicle).toMatchObject({ fuel: 'petrol', mileage: 6 })
    const departAt = new Date(Date.now() + 4 * 3600_000).toISOString()
    const preview = (await driver.post('/api/rides/cost-preview').set(H).send({ origin: campus, destination: malad, departAt, seats: 3 })).body
    expect(preview.seat.rate).toMatchObject({ fuel: 'petrol', kmPerUnit: 6, ownMileage: true, perSeatKm: 4.65 })
    expect(preview.seat.perSeatKm).toBe(4.65)
    // Saving without the field keeps it; null clears it. A CNG car is priced from CNG.
    expect((await driver.put('/api/me/vehicle').set(H).send({ ...car, fuel: 'petrol' })).body.vehicle.mileage).toBe(6)
    expect((await driver.put('/api/me/vehicle').set(H).send({ ...car, fuel: 'cng', mileage: null })).body.vehicle.mileage).toBeUndefined()
    const cng = (await driver.post('/api/rides/cost-preview').set(H).send({ origin: campus, destination: malad, departAt, seats: 3 })).body
    expect(cng.seat.rate).toMatchObject({ fuel: 'cng', unit: 'kg', kmPerUnit: 15, perSeatKm: 1.3 })

    const ride = (await driver.post('/api/rides').set(H).send({ origin: campus, destination: malad, departAt, seats: 3, maxDetourKm: 3, preferences: [] })).body
    expect(ride.farePerSeat).toBe(cng.seat.suggested)
    const q = { pickup: campus, drop: malad, date: departAt.slice(0, 10), time: '00:00', at: departAt, seats: 1, preferences: [] }

    // A rider who used to take a cab saves the cab's CO₂ for their km; one who took the train saves none.
    const cab = await student('fuel.cab@vit.edu.in')
    expect((await cab.patch('/api/me').set(H).send({ usualMode: 'cab' })).body.usualMode).toBe('cab')
    const bc = (await cab.post('/api/bookings').set(H).send({ rideId: ride.id, query: q })).body
    expect(bc.riderKm).toBeGreaterThan(10)
    expect(bc.co2Kg).toBeCloseTo(bc.riderKm * 0.231, 0)
    const train = await student('fuel.train@vit.edu.in')
    await train.patch('/api/me').set(H).send({ usualMode: 'train' })
    expect((await train.post('/api/bookings').set(H).send({ rideId: ride.id, query: q })).body.co2Kg).toBe(0)
    expect((await train.patch('/api/me').set(H).send({ usualMode: 'rocket' })).status).toBe(400)
  })
})
