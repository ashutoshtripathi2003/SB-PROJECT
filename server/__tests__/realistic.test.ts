import { afterEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_PATH = ':memory:'
process.env.TOMTOM_KEY = 'tt_test'
process.env.OLA_MAPS_KEY = 'ola_test'
process.env.MAPPLS_KEY = 'mappls_test'
process.env.CITY_SPEED_FLOOR = 'on'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const { getRoute, cityFloorMin } = await import('../routing')
const { resetMappls } = await import('../mappls')

describe('Realistic Mumbai trip times', () => {
  it('uses Ola Maps when it says the trip is slower than TomTom', async () => {
    globalThis.fetch = vi.fn(async (u: unknown) => {
      const url = String(u)
      if (url.includes('api.tomtom.com/routing'))
        return new Response(JSON.stringify({ routes: [{ summary: { lengthInMeters: 3000, travelTimeInSeconds: 240, trafficDelayInSeconds: 0, noTrafficTravelTimeInSeconds: 240 }, legs: [{ points: [{ latitude: 19.02, longitude: 72.87 }, { latitude: 19.04, longitude: 72.86 }] }] }] }))
      if (url.includes('api.olamaps.io/routing/v1/directions')) return new Response(JSON.stringify({ routes: [{ legs: [{ duration: 780, distance: 3100 }] }] }))
      return new Response('{}', { status: 404 })
    }) as typeof fetch
    const r = await getRoute({ lat: 19.0222, lng: 72.8711 }, { lat: 19.0375, lng: 72.8642 })
    expect(r.durationMin).toBeGreaterThanOrEqual(13)
    expect(r.trafficDelayMin).toBeGreaterThanOrEqual(9)
    expect(r.traffic).toBe('heavy')
  })

  it('uses Mappls when it reports more traffic than TomTom and Ola', async () => {
    resetMappls()
    const urls: string[] = []
    globalThis.fetch = vi.fn(async (u: unknown) => {
      const url = String(u)
      urls.push(url)
      if (url.includes('api.tomtom.com/routing'))
        return new Response(JSON.stringify({ routes: [{ summary: { lengthInMeters: 3000, travelTimeInSeconds: 240, trafficDelayInSeconds: 0, noTrafficTravelTimeInSeconds: 240 }, legs: [{ points: [{ latitude: 19.02, longitude: 72.87 }, { latitude: 19.04, longitude: 72.86 }] }] }] }))
      if (url.includes('api.olamaps.io')) return new Response(JSON.stringify({ routes: [{ legs: [{ duration: 420, distance: 3000 }] }] }))
      if (url.includes('/route_traffic/')) return new Response('{}', { status: 403 })
      if (url.includes('apis.mappls.com') && url.includes('/route_eta/')) return new Response(JSON.stringify({ code: 'Ok', routes: [{ duration: 840, distance: 3050 }] }))
      return new Response('{}', { status: 404 })
    }) as typeof fetch
    const r = await getRoute({ lat: 19.03, lng: 72.87 }, { lat: 19.05, lng: 72.86 })
    expect(r.durationMin).toBeGreaterThanOrEqual(14)
    // Falls through route_traffic (not allowed for this key) to route_eta.
    expect(urls.some((u) => u.includes('/route_eta/driving/72.87,19.03;72.86,19.05'))).toBe(true)
  })

  it('signs in to Mappls with Client ID/Secret and trusts its live traffic over the typical-speed rule', async () => {
    resetMappls()
    const { env } = await import('../env')
    const saved = { key: env.mapplsKey, id: env.mapplsClientId, secret: env.mapplsClientSecret }
    Object.assign(env, { mapplsKey: '', mapplsClientId: 'cid', mapplsClientSecret: 'sec' })
    const urls: string[] = []
    globalThis.fetch = vi.fn(async (u: unknown) => {
      const url = String(u)
      urls.push(url)
      if (url.includes('api.tomtom.com/routing'))
        return new Response(JSON.stringify({ routes: [{ summary: { lengthInMeters: 20000, travelTimeInSeconds: 1200, trafficDelayInSeconds: 0, noTrafficTravelTimeInSeconds: 1200 }, legs: [{ points: [{ latitude: 19.02, longitude: 72.87 }, { latitude: 19.2, longitude: 72.85 }] }] }] }))
      if (url.includes('outpost.mappls.com')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 86400 }))
      if (url.includes('route.mappls.com') && url.includes('access_token=tok')) return new Response(JSON.stringify({ routes: [{ duration: 1500, distance: 20000 }] }))
      return new Response('{}', { status: 401 })
    }) as typeof fetch
    // 20 km in the weekday evening rush: the rule alone would say ~73 min; Mappls live says 25.
    const r = await getRoute({ lat: 19.1, lng: 72.87 }, { lat: 19.25, lng: 72.86 })
    expect(r.durationMin).toBe(25)
    expect(urls.some((u) => u.includes('outpost.mappls.com'))).toBe(true)
    Object.assign(env, { mapplsKey: saved.key, mapplsClientId: saved.id, mapplsClientSecret: saved.secret })
  })

  it('never promises faster than city traffic allows', () => {
    // 3 km: at least ~6 min even at night, ~14 min in the evening rush.
    expect(cityFloorMin(3, new Date('2026-10-10T03:00:00+05:30'))).toBeGreaterThanOrEqual(6)
    // Thursday 8 Oct 2026: weekday rush and daytime.
    expect(cityFloorMin(3, new Date('2026-10-08T18:30:00+05:30'))).toBe(14)
    expect(cityFloorMin(3, new Date('2026-10-08T12:00:00+05:30'))).toBe(11)
  })

  it('is lighter on weekends and late at night', () => {
    const km = 15.5 // Andheri → VIT Wadala
    const thuRush = cityFloorMin(km, new Date('2026-10-08T18:00:00+05:30'))
    const sunEvening = cityFloorMin(km, new Date('2026-10-11T18:00:00+05:30'))
    const sunNight = cityFloorMin(km, new Date('2026-10-11T23:30:00+05:30'))
    expect(thuRush).toBe(64)
    expect(sunEvening).toBe(41)
    expect(sunNight).toBe(29)
  })
})

describe('Learning real speeds from RideSync trips', () => {
  it('uses the median speed of completed trips once there are 5 in that time of day', async () => {
    const { run } = await import('../db')
    const { learnedSpeeds, resetLearnedSpeeds } = await import('../routing')
    // 5 evening-rush trips of ~10 road-km taking 50 min each → ~12 km/h.
    const a = { lat: 19.0222, lng: 72.8711 }
    const b = { lat: 19.0222 + 0.0647, lng: 72.8711 } // ~7.2 km straight → ~10 km by road
    for (let i = 0; i < 5; i++) {
      const start = new Date(Date.now() - (i + 1) * 7 * 86_400_000) // same weekday each week
      start.setUTCHours(13, 0, 0, 0) // 18:30 IST
      run(`INSERT INTO users (id, email, name, created_at) VALUES (?, ?, 'T', ?) ON CONFLICT DO NOTHING`, 'u_learn', 'learn@vit.edu.in', start.toISOString())
      run(`INSERT INTO rides (id, driver_id, origin, destination, depart_at, seats_total, fare_per_seat, max_detour_km, vehicle_id, route, distance_km, duration_min, status, created_at) VALUES (?, 'u_learn', '{}', '{}', ?, 3, 50, 2, 'v', '[]', 10, 20, 'completed', ?)`, `r_l${i}`, start.toISOString(), start.toISOString())
      run(
        `INSERT INTO bookings (id, ride_id, rider_id, pickup, drop_place, seats, fare, status, match_score, picked_up_at, dropped_at, created_at, updated_at) VALUES (?, ?, 'u_learn', ?, ?, 1, 50, 'completed', 90, ?, ?, ?, ?)`,
        `b_l${i}`, `r_l${i}`, JSON.stringify(a), JSON.stringify(b), start.toISOString(), new Date(start.getTime() + 50 * 60_000).toISOString(), start.toISOString(), start.toISOString(),
      )
    }
    resetLearnedSpeeds()
    // 18:30 IST on days before today: check the slots that got trips.
    const all = Object.values(learnedSpeeds())
    const kmh = Math.max(...all)
    expect(kmh).toBeGreaterThan(9)
    expect(kmh).toBeLessThan(15)
  })
})
