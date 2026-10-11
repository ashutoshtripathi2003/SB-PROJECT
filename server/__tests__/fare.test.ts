import request from 'supertest'
import { beforeAll, describe, expect, it, vi } from 'vitest'

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

describe('the actual trip (GPS track)', () => {
  // A point every 6 s along a straight line, at a given speed (km/h).
  function drive(startMs: number, minutes: number, kmh: number, from = { lat: 19.0, lng: 72.85 }) {
    const pts = []
    for (let s = 0; s <= minutes * 60; s += 6) pts.push({ at: startMs + s * 1000, lat: from.lat + ((kmh * s) / 3600 / 111.2), lng: from.lng })
    return pts
  }

  it('measures distance and turns slow minutes into heavy-traffic fuel', () => {
    const cruise = fare.trackChunks(drive(0, 10, 45))
    const km = cruise.reduce((s, c) => s + c.km, 0)
    expect(km).toBeCloseTo(7.5, 0)
    expect(cruise.length).toBe(10)
    expect(fare.mileageAt(5, venue)).toBe(3.5)
    expect(fare.mileageAt(30, venue)).toBe(11.5)
    expect(fare.mileageAt(20, venue)).toBeCloseTo(7.5, 5)
    // The same 2 km in a 20-minute jam burns far more than in 4 minutes of free driving.
    const jam = fare.trackCost(fare.trackChunks(drive(0, 20, 6)), 'diesel', venue, [])
    const free = fare.trackCost(fare.trackChunks(drive(0, 4, 30)), 'diesel', venue, [])
    expect(jam.fuelUsed).toBeGreaterThan(free.fuelUsed * 2.5)
    expect(jam.stuckMinutes).toBe(20)
  })

  it('counts idling when the car stands still (no points sent) and skips GPS jumps', () => {
    const stopped = [{ at: 0, lat: 19, lng: 72.85 }, { at: 10 * 60_000, lat: 19.00001, lng: 72.85 }]
    const c = fare.trackCost(fare.trackChunks(stopped), 'diesel', venue, [])
    expect(c.fuelUsed).toBeCloseTo((0.7 * 10) / 60, 2) // 10 min idling at 0.7 L/h
    const glitch = [{ at: 0, lat: 19, lng: 72.85 }, { at: 5000, lat: 19.5, lng: 72.85 }, { at: 10000, lat: 19.0001, lng: 72.85 }]
    expect(fare.trackChunks(glitch).reduce((s, x) => s + x.km, 0)).toBeLessThan(0.05)
  })

  it('splits every minute among the people in the car then', () => {
    // 30 min: A aboard the whole time, B only the second half. Driver alone for 10 min first.
    const pts = drive(0, 40, 30)
    const chunks = fare.trackChunks(pts)
    const res = fare.trackCost(chunks, 'petrol', {}, [
      { id: 'A', seats: 1, from: 10 * 60_000, to: 40 * 60_000 + 1 },
      { id: 'B', seats: 1, from: 25 * 60_000, to: 40 * 60_000 + 1 },
    ])
    const A = res.riders.get('A')!
    const B = res.riders.get('B')!
    expect(A.km).toBeCloseTo(15, 0)
    expect(B.km).toBeCloseTo(7.5, 0)
    // Every minute is paid in full: riders' exact shares + the driver's = the whole cost.
    expect(Math.abs(A.exact + B.exact + res.driverShare - res.total)).toBeLessThanOrEqual(2)
    // A paid half of 15 min + a third of 15 min; B a third of 15 min.
    expect(A.exact / B.exact).toBeCloseTo(2.5, 0)
    // Never above a rider's maximum.
    const capped = fare.trackCost(chunks, 'petrol', {}, [{ id: 'A', seats: 1, from: 0, to: Infinity, max: 40 }])
    expect(capped.riders.get('A')!.fare).toBe(40)
  })

  it('learns the car from its trip computer', () => {
    expect(fare.updatedFactor(null, 0, 3, 2.5)).toEqual({ factor: 1.2, samples: 1 })
    expect(fare.updatedFactor(1.2, 1, 2, 2)).toEqual({ factor: 1.1, samples: 2 })
    expect(fare.updatedFactor(null, 0, 10, 2).factor).toBe(1.6) // a typo can't wreck it
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

  it('never charges above the guaranteed maximum, and has a minimum', () => {
    const max = fare.maxFare(400, 20, 20, 1)
    expect(max).toBe(230) // alone: 400/2 = 200, +15% traffic head-room
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
  it('saves mileage, previews the cost, re-splits as riders join, and settles each rider at drop-off from the GPS track', async () => {
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

    // Rider A joins alone: half the cost. Pays by UPI.
    const a = await student('fare.a@vit.edu.in')
    const ba = (await a.post('/api/bookings').set(H).send({ rideId: ride.id, query })).body
    await driver.post(`/api/bookings/${ba.id}/respond`).set(H).send({ accept: true })
    let bookA = (await a.get(`/api/bookings/${ba.id}`)).body.booking
    expect(Math.abs(bookA.fare - cost / 2)).toBeLessThanOrEqual(5)
    expect(bookA).toMatchObject({ fareFinal: false })
    const paidA = bookA.fare as number
    expect((await a.post(`/api/bookings/${ba.id}/pay`).set(H).send({ method: 'upi' })).status).toBe(200)

    // Rider B joins: A's share drops to a third, and A is told.
    const b = await student('fare.b@vit.edu.in')
    const bb = (await b.post('/api/bookings').set(H).send({ rideId: ride.id, query })).body
    await driver.post(`/api/bookings/${bb.id}/respond`).set(H).send({ accept: true })
    bookA = (await a.get(`/api/bookings/${ba.id}`)).body.booking
    expect(bookA.fare).toBeLessThan(paidA)
    expect(Math.abs(bookA.fare - cost / 3)).toBeLessThanOrEqual(5)
    expect((await a.get('/api/notifications')).body.map((n: { title: string }) => n.title)).toContain(`Your share went down to ₹${bookA.fare}`)
    await b.post(`/api/bookings/${bb.id}/pay`).set(H).send({ method: 'cash' })

    // The trip, as the driver's phone reports it: 20 minutes crawling through a jam, then moving.
    // B gets off two-thirds of the way; A rides to the end. Shares are fixed at each drop-off.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const t0 = Date.now()
      const at = (min: number) => vi.setSystemTime(t0 + min * 60_000)
      const pos = (min: number) => {
        const f = min <= 20 ? (0.15 * min) / 20 : 0.15 + (0.85 * (min - 20)) / 40
        return { lat: campus.lat + (malad.lat - campus.lat) * f, lng: campus.lng + (malad.lng - campus.lng) * f }
      }
      expect((await driver.post(`/api/rides/${ride.id}/start`).set(H).send({})).status).toBe(200)
      expect((await a.get(`/api/bookings/${ba.id}`)).body.booking.fareFinal).toBe(false)
      for (const [rider, id] of [[a, ba.id], [b, bb.id]] as const) {
        const pin = (await rider.get(`/api/bookings/${id}`)).body.ridePin
        expect((await driver.post(`/api/bookings/${id}/picked-up`).set(H).send({ pin })).status).toBe(200)
      }
      for (let min = 0; min <= 60; min++) {
        at(min)
        await driver.post(`/api/rides/${ride.id}/location`).set(H).send(pos(min))
        if (min === 40) expect((await driver.post(`/api/bookings/${bb.id}/dropped`).set(H).send({})).status).toBe(200)
      }
      const finalB = (await b.get(`/api/bookings/${bb.id}`)).body.booking
      expect(finalB).toMatchObject({ fareFinal: true, fareDetail: { source: 'track' } })
      expect(finalB.fareDetail.km).toBeGreaterThan(9)
      expect(finalB.fareDetail.km).toBeLessThan(15)
      expect((await driver.post(`/api/bookings/${ba.id}/dropped`).set(H).send({})).status).toBe(200)
      // Trip computer: the Venue showed 7 km/L for this trip.
      expect((await driver.post(`/api/rides/${ride.id}/complete`).set(H).send({ avgMileage: 7 })).status).toBe(200)

      const finalA = (await a.get(`/api/bookings/${ba.id}`)).body.booking
      expect(finalA).toMatchObject({ fareFinal: true, fareDetail: { source: 'track' } })
      expect(finalA.fare).toBeGreaterThan(finalB.fare) // A rode further
      expect(finalA.fare).toBeLessThanOrEqual(finalA.fareMax)
      expect(finalA.settleDue).toBe(finalA.fare - paidA) // paid by UPI before the trip
      expect(finalA.fareDetail.summary).toMatch(/crawling in traffic/)

      // Equal split: the riders' exact shares plus the driver's add up to the trip's cost.
      const done = (await driver.get(`/api/rides/${ride.id}`)).body.ride
      expect(Math.abs(finalA.fareDetail.exact + finalB.fareDetail.exact + done.driverShare - done.costTotal)).toBeLessThanOrEqual(2)
      // A 7 km/L trip computer reading teaches RideSync this car.
      const me = (await driver.get('/api/me')).body
      expect(me.vehicle.fuelSamples).toBe(1)
      expect(me.vehicle.fuelFactor).toBeGreaterThan(0.6)
    } finally {
      vi.useRealTimers()
    }
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
