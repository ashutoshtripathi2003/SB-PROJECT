import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_PATH = ':memory:'
process.env.DEV_LOGIN = 'true'
process.env.ALLOWED_EMAIL_DOMAIN = 'vit.edu.in'
process.env.OSRM_URL = 'http://127.0.0.1:9'
process.env.TOMTOM_KEY = 'test-key'
// Compare TomTom's forecast with its live traffic only; the Mumbai minimum speed would make this depend on the hour the tests run.
process.env.CITY_SPEED_FLOOR = 'off'

// TomTom: the forecast for the departure time says rush hour (113 min, 58 min on empty roads);
// the live traffic when the driver starts is clear (58 min).
const realFetch = globalThis.fetch
const H = { 'x-ridesync': '1' }
const campus = { id: 'vit-campus', name: 'VIT Wadala', area: 'Wadala', lat: 19.0222, lng: 72.8711, kind: 'campus' }
const malad = { id: 'malad', name: 'Malad', area: 'Malad Station', lat: 19.1868, lng: 72.8484, kind: 'station' }
function tomtom(minutes: number) {
  return new Response(
    JSON.stringify({
      routes: [
        {
          summary: { lengthInMeters: 25000, travelTimeInSeconds: minutes * 60, noTrafficTravelTimeInSeconds: 58 * 60, trafficDelayInSeconds: (minutes - 58) * 60 },
          legs: [{ points: [{ latitude: campus.lat, longitude: campus.lng }, { latitude: malad.lat, longitude: malad.lng }] }],
          sections: [],
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

let app: Parameters<typeof request>[0]
beforeAll(async () => {
  globalThis.fetch = vi.fn(async (u: unknown, init?: RequestInit) => {
    const url = String(u)
    if (url.includes('api.tomtom.com/routing')) return tomtom(url.includes('departAt=') ? 113 : 58)
    if (url.startsWith('http://127.0.0.1')) return realFetch(u as string, init)
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  app = (await import('../app')).createApp()
})
afterAll(() => {
  globalThis.fetch = realFetch
})

let seq = 0
async function student(email: string, extra: Record<string, unknown> = {}) {
  const agent = request.agent(app)
  await agent.post('/api/auth/dev').set(H).send({ email })
  await agent.patch('/api/me').set(H).send({ phone: `98222${String(++seq).padStart(5, '0')}`, studentId: `START${seq}01`, onboarded: true, ...extra })
  return agent
}

describe('price at the start', () => {
  it('drops when the live traffic is lighter than forecast, and never goes up', async () => {
    const driver = await student('start.driver@vit.edu.in', { upiId: 'driver@okaxis' })
    await driver.put('/api/me/vehicle').set(H).send({ make: 'Hyundai', model: 'Venue', color: 'Grey', plate: 'MH01AB9999', seats: 3, fuel: 'diesel' })
    const departAt = new Date(Date.now() + 3 * 3600_000).toISOString()
    const preview = (await driver.post('/api/rides/cost-preview').set(H).send({ origin: campus, destination: malad, departAt, seats: 3 })).body
    // Diesel at 13 km/L: 25 ÷ 13 = 1.92 L + 55 min × 0.7 L/h = 0.64 L → 2.57 L × ₹97.83 = ₹251.
    expect(preview.cost).toMatchObject({ km: 25, min: 113, trafficMin: 55, fuel: 'diesel', total: 251 })
    expect(preview.trafficDelayMin).toBe(55)
    const ride = (await driver.post('/api/rides').set(H).send({ origin: campus, destination: malad, departAt, seats: 3, maxDetourKm: 3, preferences: [] })).body

    const rider = await student('start.rider@vit.edu.in')
    const query = { pickup: campus, drop: malad, date: departAt.slice(0, 10), time: '00:00', at: departAt, seats: 1, preferences: [] }
    const bk = (await rider.post('/api/bookings').set(H).send({ rideId: ride.id, query })).body
    await driver.post(`/api/bookings/${bk.id}/respond`).set(H).send({ accept: true })
    const booked = (await rider.get(`/api/bookings/${bk.id}`)).body.booking
    // Booked at: half the rush-hour cost plus the 10% cushion.
    expect(Math.abs(booked.fare - (ride.costTotal * 1.1) / 2)).toBeLessThanOrEqual(5)
    expect((await rider.post(`/api/bookings/${bk.id}/pay`).set(H).send({ method: 'upi' })).status).toBe(200)
    expect((await rider.get(`/api/bookings/${bk.id}`)).body.booking.paidAmount).toBe(booked.fareMax)

    // The driver starts: traffic is clear, so the real cost is lower and the price drops.
    expect((await driver.post(`/api/rides/${ride.id}/start`).set(H).send({})).status).toBe(200)
    const final = (await rider.get(`/api/bookings/${bk.id}`)).body.booking
    expect(final.fareFinal).toBe(true)
    expect(final.fare).toBeLessThan(booked.fare * 0.8)
    expect(final.settleDue).toBe(final.fare - booked.fareMax) // the driver returns the difference
    const titles = (await rider.get('/api/notifications')).body.map((n: { title: string }) => n.title)
    expect(titles.some((t: string) => t.includes('driver returns'))).toBe(true)
  })
})
