import { haversineKm, polylineLengthKm, ROAD_CIRCUITY, syntheticRoute } from '../src/lib/geo'
import type { LatLng } from '../src/lib/types'
import { bandOf, dayOf, factorFor, type Band, type Day } from './calibrate'
import { all } from './db'
import { predictEta } from './ml/models'
import { env } from './env'
import { googleConfigured, googleRoute } from './google'
import { olaDirections } from './landmarks'
import { mapplsDirections } from './mappls'
import { tomtomConfigured, tomtomRoute, trafficLevel, type TrafficLevel, type TrafficSegment } from './traffic'

export type Route = {
  coords: LatLng[]
  distanceKm: number
  durationMin: number
  source: 'google' | 'tomtom' | 'osrm' | 'estimate'
  /** Extra minutes caused by traffic right now (TomTom only). */
  trafficDelayMin?: number
  traffic?: TrafficLevel
  /** Slow/heavy stretches by index into coords (live traffic only); the rest of the route is clear. */
  segments?: TrafficSegment[]
}

const cache = new Map<string, Route>()
// Traffic changes by the minute, so traffic-aware routes are only reused briefly.
const liveCache = new Map<string, { at: number; route: Route }>()
const key = (a: LatLng, b: LatLng) => `${a.lat.toFixed(4)},${a.lng.toFixed(4)}|${b.lat.toFixed(4)},${b.lng.toFixed(4)}`

export function estimateRoute(a: LatLng, b: LatLng): Route {
  const coords = syntheticRoute(a, b)
  const distanceKm = Math.max(polylineLengthKm(coords), haversineKm(a, b) * ROAD_CIRCUITY)
  return { coords, distanceKm, durationMin: Math.round((distanceKm / (distanceKm < 40 ? 22 : 50)) * 60 + 5), source: 'estimate' }
}

/** Road route from OSRM, simplified to keep rows small. Falls back to an estimate. */
function simplify(pts: LatLng[]) {
  const step = Math.max(1, Math.floor(pts.length / 250))
  return pts.filter((_, i) => i % step === 0 || i === pts.length - 1)
}

/** Same as simplify(), keeping traffic stretches pointing at the right (kept) points. */
function simplifyWithSegments(pts: LatLng[], segments: TrafficSegment[]) {
  const step = Math.max(1, Math.floor(pts.length / 250))
  const coords = simplify(pts)
  const at = (i: number) => Math.min(coords.length - 1, i >= pts.length - 1 ? coords.length - 1 : Math.round(i / step))
  return { coords, segments: segments.map((s) => ({ ...s, from: at(s.from), to: Math.max(at(s.to), at(s.from) + 1) })).filter((s) => s.to <= coords.length - 1) }
}

/** OpenRouteService (when ORS_API_KEY is set). */
async function orsRoute(a: LatLng, b: LatLng): Promise<Route> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 5000)
  try {
    const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: env.orsKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: [[a.lng, a.lat], [b.lng, b.lat]] }),
    })
    if (!res.ok) throw new Error(`ors ${res.status}`)
    const json = (await res.json()) as { features?: { geometry: { coordinates: [number, number][] }; properties: { summary: { distance: number; duration: number } } }[] }
    const f = json.features?.[0]
    if (!f) throw new Error('no route')
    return {
      coords: simplify(f.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }))),
      distanceKm: f.properties.summary.distance / 1000,
      durationMin: Math.round(f.properties.summary.duration / 60),
      source: 'osrm',
    }
  } finally {
    clearTimeout(t)
  }
}

/**
 * Typical Mumbai door-to-door car speeds (km/h) — close to what Google Maps shows for city trips.
 * Weekends are lighter: Sunday has no office rush at all.
 */
const MUMBAI_KMH: Record<Day, Record<Band, number>> = {
  weekday: { rush: 15, day: 20, evening: 24, night: 32 },
  saturday: { rush: 20, day: 21, evening: 24, night: 32 },
  sunday: { rush: 24, day: 24, evening: 26, night: 34 },
}

type Slot = `${Day}:${Band}`
let learned: { at: number; kmh: Partial<Record<Slot, number>> } = { at: 0, kmh: {} }
/** Test hook. */
export const resetLearnedSpeeds = () => {
  learned = { at: 0, kmh: {} }
}

export function learnedSpeeds(): Partial<Record<Slot, number>> {
  if (Date.now() - learned.at < 10 * 60_000) return learned.kmh
  const by: Partial<Record<Slot, number[]>> = {}
  try {
    const rows = all<{ pickup: string; drop_place: string; picked_up_at: string; dropped_at: string }>(
      `SELECT pickup, drop_place, picked_up_at, dropped_at FROM bookings WHERE status = 'completed' AND picked_up_at IS NOT NULL AND dropped_at IS NOT NULL AND dropped_at >= ?`,
      new Date(Date.now() - 60 * 86_400_000).toISOString(),
    )
    for (const r of rows) {
      const a = JSON.parse(r.pickup) as LatLng
      const b = JSON.parse(r.drop_place) as LatLng
      const min = (new Date(r.dropped_at).getTime() - new Date(r.picked_up_at).getTime()) / 60_000
      const km = haversineKm(a, b) * ROAD_CIRCUITY
      if (km < 2 || min < 4 || min > 180) continue
      const at = new Date(r.picked_up_at)
      ;(by[`${dayOf(at)}:${bandOf(at)}`] ??= []).push(km / (min / 60))
    }
  } catch {
    /* database not ready */
  }
  const kmh: Partial<Record<Slot, number>> = {}
  for (const k of Object.keys(by) as Slot[]) {
    const v = by[k]!.sort((x, y) => x - y)
    if (v.length >= 5) kmh[k] = Math.min(45, Math.max(8, v[Math.floor(v.length / 2)]))
  }
  learned = { at: Date.now(), kmh }
  return kmh
}

/**
 * Realistic minimum trip time for Mumbai at that hour. Free traffic feeds (TomTom, Ola) often
 * show Mumbai roads faster than they really are, which put RideSync ~30 min ahead of Google Maps
 * at rush hour. Uses RideSync's own trip history once there's enough; on by default
 * (CITY_SPEED_FLOOR=off disables it). Not applied when Google traffic is in use.
 */
export function cityFloorMin(distanceKm: number, when = new Date()): number {
  if (process.env.CITY_SPEED_FLOOR === 'off' || googleConfigured()) return 0
  const day = dayOf(when)
  const band = bandOf(when)
  const kmh = learnedSpeeds()[`${day}:${band}`] ?? MUMBAI_KMH[day][band]
  return Math.round((distanceKm / kmh) * 60 + 2)
}

const olaCache = new Map<string, { at: number; ola: number | null; mappls: { min: number; live: boolean } | null }>()

/** Take the slowest of the live-traffic sources: the route service (Google or TomTom), Ola Maps and Mappls. */
async function realistic(route: Route, a: LatLng, b: LatLng, departAt?: Date): Promise<Route> {
  const when = departAt && departAt.getTime() > Date.now() ? departAt : new Date()
  let ola: number | null = null
  let mappls: { min: number; live: boolean } | null = null
  // Ola and Mappls reflect traffic now, so only use them for trips starting within the hour.
  if (when.getTime() - Date.now() < 3600_000) {
    const k = `${key(a, b)}|${Math.floor(Date.now() / 120_000)}`
    const hit = olaCache.get(k)
    if (hit) ({ ola, mappls } = hit)
    else {
      const [o, m] = await Promise.all([olaDirections(a, b), mapplsDirections(a, b)])
      ola = o?.durationMin ?? null
      mappls = m ? { min: m.durationMin, live: !!m.live } : null
      if (olaCache.size > 1000) olaCache.clear()
      olaCache.set(k, { at: Date.now(), ola, mappls })
    }
  }
  // Each source corrected by how it has compared with real RideSync trips at this day/time.
  const fix = (src: 'tomtom' | 'ola' | 'mappls', min: number | null) => {
    if (!min) return { min: 0, calibrated: false }
    const f = factorFor(src, when)
    return { min: Math.round(min * (f ?? 1)), calibrated: f !== null }
  }
  const tt = fix('tomtom', route.source === 'tomtom' ? route.durationMin : null)
  const ol = fix('ola', ola)
  const mp = fix('mappls', mappls?.min ?? null)
  // Until real trips have calibrated a source (or Mappls answers with live traffic), never go
  // faster than typical Mumbai speeds for the hour.
  // Trained trip-time model (ridge regression on real RideSync trips) beats everything else.
  const ml = when.getTime() - Date.now() < 3600_000 ? predictEta({ km: route.distanceKm, tomtom: route.source === 'tomtom' ? route.durationMin : null, ola, mappls: mappls?.min ?? null, at: when.toISOString() }) : null
  if (ml !== null) {
    const freeFlowMl = Math.max(1, route.durationMin - (route.trafficDelayMin ?? 0))
    const delayMl = Math.max(0, ml - freeFlowMl)
    return { ...route, durationMin: Math.max(ml, Math.round(freeFlowMl * 0.8)), trafficDelayMin: delayMl, traffic: trafficLevel(delayMl, freeFlowMl) }
  }
  const trusted = tt.calibrated || ol.calibrated || mp.calibrated || !!mappls?.live
  const best = Math.max(route.source === 'tomtom' ? tt.min : route.durationMin, ol.min, mp.min, trusted ? 0 : cityFloorMin(route.distanceKm, when))
  if (best === route.durationMin) return route
  const freeFlow = Math.max(1, route.durationMin - (route.trafficDelayMin ?? 0))
  const delay = Math.max(0, best - freeFlow)
  return { ...route, durationMin: best, trafficDelayMin: delay, traffic: trafficLevel(delay, freeFlow) }
}

export async function getRoute(a: LatLng, b: LatLng, opts: { departAt?: Date } = {}): Promise<Route> {
  return realistic(await baseRoute(a, b, opts), a, b, opts.departAt)
}

async function baseRoute(a: LatLng, b: LatLng, opts: { departAt?: Date } = {}): Promise<Route> {
  const k = key(a, b)
  if (tomtomConfigured() && !googleConfigured()) {
    const lk = `${k}|${opts.departAt ? Math.round(opts.departAt.getTime() / 900_000) : 'now'}`
    const live = liveCache.get(lk)
    if (live && Date.now() - live.at < 120_000) return live.route
    try {
      const r = await tomtomRoute(a, b, opts.departAt)
      const route: Route = { ...r, ...simplifyWithSegments(r.coords, r.segments), source: 'tomtom' }
      if (liveCache.size > 500) liveCache.clear()
      liveCache.set(lk, { at: Date.now(), route })
      return route
    } catch (e) {
      console.error('[ridesync] TomTom traffic route failed, falling back', (e as Error).message)
    }
  }
  if (googleConfigured()) {
    // Google's live traffic changes by the minute: reuse for 2 minutes only.
    const gk = `g|${k}`
    const live = liveCache.get(gk)
    if (live && Date.now() - live.at < 120_000) return live.route
    try {
      const r = await googleRoute(a, b)
      const delay = Math.max(0, r.durationMin - r.freeFlowMin)
      const route: Route = { ...simplifyWithSegments(r.coords, r.segments), distanceKm: r.distanceKm, durationMin: r.durationMin, trafficDelayMin: delay, traffic: trafficLevel(delay, r.freeFlowMin), source: 'google' }
      if (liveCache.size > 500) liveCache.clear()
      liveCache.set(gk, { at: Date.now(), route })
      return route
    } catch (e) {
      console.error('[ridesync] Google routes failed, falling back', (e as Error).message)
    }
  }
  const hit = cache.get(k)
  if (hit) return hit
  if (env.orsKey) {
    try {
      const route = await orsRoute(a, b)
      cache.set(k, route)
      return route
    } catch (e) {
      console.error('[ridesync] openrouteservice failed, falling back to OSRM', (e as Error).message)
    }
  }
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    const res = await fetch(`${env.osrmUrl}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`, { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) throw new Error(String(res.status))
    const json = (await res.json()) as { routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] }
    const r = json.routes?.[0]
    if (!r) throw new Error('no route')
    const coords = simplify(r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })))
    const route: Route = { coords, distanceKm: r.distance / 1000, durationMin: Math.round(r.duration / 60), source: 'osrm' }
    if (cache.size > 500) cache.clear()
    cache.set(k, route)
    return route
  } catch {
    return estimateRoute(a, b)
  }
}
