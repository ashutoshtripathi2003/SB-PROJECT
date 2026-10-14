import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'

process.env.DATABASE_PATH = ':memory:'
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
  it('suggests distance × ₹2 a seat, and lets the driver choose half to one and a half times it', () => {
    expect(fare.fareMode()).toBe('seat')
    expect(fare.seatPrice(25)).toEqual({ suggested: 50, min: 30, max: 75, perSeatKm: 2 })
    expect(fare.seatPrice(100)).toEqual({ suggested: 200, min: 100, max: 300, perSeatKm: 2 })
    // Short trips never go below ₹30 a seat.
    expect(fare.seatPrice(4)).toEqual({ suggested: 30, min: 30, max: 45, perSeatKm: 2 })
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
    await driver.put('/api/me/vehicle').set(H).send({ make: 'Maruti', model: 'Swift', color: 'Red', plate: 'MH01AB5555', seats: 3, fuel: 'petrol' })
    const departAt = new Date(Date.now() + 3 * 3600_000).toISOString()
    const preview = (await driver.post('/api/rides/cost-preview').set(H).send({ origin: campus, destination: malad, departAt, seats: 3 })).body
    expect(preview.mode).toBe('seat')
    expect(preview.seat).toEqual(fare.seatPrice(preview.distanceKm))

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
