import type { Place } from '../src/lib/types'
import { haversineKm } from '../src/lib/geo'
import { env } from './env'
import { decodePolyline } from './google'
import { olaFetch, olaReady } from './ola'

/**
 * Building and landmark names for a dropped pin, from services that know Indian
 * buildings better than OpenStreetMap:
 *   OLA_MAPS_KEY → Ola Maps (societies, towers, gates, local landmarks) — maps.olakrutrim.com
 *   TOMTOM_KEY   → TomTom nearby places (colleges, hospitals, malls, shops) — developer.tomtom.com
 * Every function returns null when it has nothing useful, so the caller falls through
 * to the next service.
 */

export const olaConfigured = olaReady
const olaGet = async <T>(url: string): Promise<T> => (await (await olaFetch(url, { headers: { 'Accept-Language': 'en' } })).json()) as T
export type PlaceName = { name: string; area: string }

/** "NH 48", "Western Express Highway", "SH-1"… — not useful as a pickup name. */
export const isHighway = (name: string) => /\b(N\.?H\.?|S\.?H\.?)[\s-]*\d+|national highway|state highway|expressway|highway|flyover|bypass/i.test(name)
/** "400031", "Unnamed Road", "18/2" — not a name. */
const isJunk = (s: string) => !s || /^\d[\d\s/-]*$/.test(s) || /^unnamed/i.test(s) || /^india$/i.test(s)
const usable = (s: string | undefined): s is string => !!s && !isJunk(s.trim()) && !isHighway(s)

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { 'Accept-Language': 'en', 'X-Request-Id': `ridesync-${Date.now()}` } })
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`)
  return (await res.json()) as T
}

const parts = (address: string) =>
  address
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

/* ---- Ola Maps ---------------------------------------------------------------- */

type OlaPrediction = {
  place_id?: string
  description?: string
  structured_formatting?: { main_text?: string; secondary_text?: string }
  geometry?: { location?: { lat: number; lng: number } }
  distance_meters?: number
}

/** Named venue within ~60 m, else the first meaningful part of the street address. */
// Ola's nearby search refuses some keys (400); after the first refusal the address lookup below is used alone.
let olaNearbyOff = false

export async function olaReverse(lat: number, lng: number): Promise<PlaceName | null> {
  if (!olaNearbyOff) try {
    const near = await olaGet<{ predictions?: OlaPrediction[] }>(
      `https://api.olamaps.io/places/v1/nearbysearch?layers=venue&location=${lat},${lng}&radius=60&limit=5`,
    )
    const best = (near.predictions ?? [])
      .filter((p) => usable(p.structured_formatting?.main_text) && (p.distance_meters == null || p.distance_meters <= 60))
      .sort((a, b) => (a.distance_meters ?? 0) - (b.distance_meters ?? 0))[0]
    if (best) {
      const name = best.structured_formatting!.main_text!.trim()
      return { name, area: parts(best.structured_formatting?.secondary_text ?? best.description ?? '').filter((s) => s !== name).slice(0, 2).join(', ') }
    }
  } catch (e) {
    const msg = (e as Error).message
    if (/\b400\b/.test(msg)) {
      olaNearbyOff = true
      console.log('[ridesync] Ola Maps nearby search not available for this key — using Ola address lookup and TomTom for pin names instead')
    } else console.error('[ridesync] Ola Maps nearby failed', msg)
  }
  try {
    const r = await olaGet<{ results?: { name?: string; formatted_address?: string }[] }>(`https://api.olamaps.io/places/v1/reverse-geocode?latlng=${lat},${lng}`)
    for (const x of r.results ?? []) {
      const segs = parts(x.formatted_address ?? '')
      const name = usable(x.name) ? x.name.trim() : segs.find(usable)
      if (name) return { name, area: segs.filter((s) => s !== name && usable(s)).slice(0, 2).join(', ') }
    }
  } catch (e) {
    console.error('[ridesync] Ola Maps place name failed', (e as Error).message)
  }
  return null
}

/** Ola Maps search suggestions, biased to campus. */
export async function olaSearch(q: string, near: { lat: number; lng: number }): Promise<Place[]> {
  const r = await olaGet<{ predictions?: OlaPrediction[] }>(
    `https://api.olamaps.io/places/v1/autocomplete?input=${encodeURIComponent(q)}&location=${near.lat},${near.lng}`,
  )
  return (r.predictions ?? [])
    .filter((p) => p.geometry?.location && (p.structured_formatting?.main_text || p.description))
    .slice(0, 6)
    .map((p, i) => {
      const name = (p.structured_formatting?.main_text || parts(p.description!)[0]).trim()
      return {
        id: `ola-${p.place_id ?? i}`.slice(0, 80),
        name,
        area: parts(p.structured_formatting?.secondary_text ?? p.description ?? '').filter((s) => s !== name).slice(0, 2).join(', '),
        lat: p.geometry!.location!.lat,
        lng: p.geometry!.location!.lng,
        kind: 'custom' as const,
      }
    })
}

/* ---- TomTom nearby places ------------------------------------------------------ */

type TTResult = { dist?: number; poi?: { name?: string }; address?: { municipalitySubdivision?: string; municipality?: string; streetName?: string }; position?: { lat: number; lon: number } }

/** Closest named place (college, hospital, shop, station…) within ~60 m of the pin. */
export async function tomtomNearby(lat: number, lng: number): Promise<PlaceName | null> {
  if (!env.tomtomKey) return null
  try {
    const r = await getJson<{ results?: TTResult[] }>(
      `https://api.tomtom.com/search/2/nearbySearch/.json?key=${encodeURIComponent(env.tomtomKey)}&lat=${lat}&lon=${lng}&radius=60&limit=8&language=en-GB`,
    )
    const best = (r.results ?? [])
      .map((x) => ({ x, d: x.dist ?? (x.position ? haversineKm({ lat, lng }, { lat: x.position.lat, lng: x.position.lon }) * 1000 : 999) }))
      .filter(({ x, d }) => usable(x.poi?.name) && d <= 60)
      .sort((a, b) => a.d - b.d)[0]?.x
    if (!best) return null
    const name = best.poi!.name!.trim()
    const a = best.address ?? {}
    return { name, area: [a.municipalitySubdivision || a.streetName, a.municipality].filter((s) => s && !name.includes(s)).join(', ') }
  } catch (e) {
    console.error('[ridesync] TomTom nearby places failed', (e as Error).message)
    return null
  }
}

/* ---- Ola Maps driving time (Indian traffic) ------------------------------------ */

/**
 * Driving time from Ola Maps, which is built on Indian road and traffic data — usually much
 * closer to real Mumbai times than other free services. Null if unavailable.
 */
export async function olaDirections(a: { lat: number; lng: number }, b: { lat: number; lng: number }): Promise<{ durationMin: number; distanceKm: number; coords: { lat: number; lng: number }[] } | null> {
  if (!olaReady()) return null
  try {
    const res = await olaFetch(
      `https://api.olamaps.io/routing/v1/directions?origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&mode=driving&alternatives=false&steps=false&overview=full&traffic_metadata=true`,
      { method: 'POST' },
    )
    if (!res.ok) throw new Error(`ola directions ${res.status}`)
    const j = (await res.json()) as {
      routes?: { overview_polyline?: string; legs?: { duration?: number | { value?: number }; duration_in_traffic?: number | { value?: number }; distance?: number | { value?: number } }[] }[]
    }
    const r = j.routes?.[0]
    const legs = r?.legs ?? []
    const num = (v: number | { value?: number } | undefined) => (typeof v === 'number' ? v : (v?.value ?? 0))
    // With traffic metadata Ola may also send the time in current traffic; use whichever is longer.
    const seconds = legs.reduce((t, l) => t + Math.max(num(l.duration), num(l.duration_in_traffic)), 0)
    const meters = legs.reduce((t, l) => t + num(l.distance), 0)
    if (!seconds || !meters) return null
    let coords: { lat: number; lng: number }[] = []
    try {
      coords = r?.overview_polyline ? decodePolyline(r.overview_polyline) : []
    } catch {
      coords = []
    }
    return { durationMin: Math.max(1, Math.round(seconds / 60)), distanceKm: meters / 1000, coords }
  } catch (e) {
    console.error('[ridesync] Ola Maps directions failed', (e as Error).message)
    return null
  }
}
