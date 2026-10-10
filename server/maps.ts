import type { Place } from '../src/lib/types'
import { CAMPUS } from '../src/data/places'
import { basemapAttribution } from './basemap'
import { env } from './env'
import { googleAutocomplete, googleConfigured, googlePlaceDetails, googleReverse } from './google'
import { isHighway, olaConfigured, olaReverse, olaSearch, tomtomNearby } from './landmarks'
import { olaHasKey } from './ola'
import { tomtomConfigured } from './traffic'

/**
 * Map services. Everything works without keys (OpenStreetMap / CARTO / OSRM);
 * add free keys for production-grade reliability:
 *   MAPTILER_KEY  → map tiles + place search   (maptiler.com, free tier)
 *   ORS_API_KEY   → driving routes             (openrouteservice.org, free tier)
 *   GOOGLE_MAPS_API_KEY → Google map, search, place names and routes (takes priority)
 * If Google fails (quota, bad key), the free services are used instead.
 */

/**
 * MapTiler key check. A wrong or restricted key makes MapTiler draw "API key required"
 * on every tile, so the key is tested at startup and RideSync falls back to the
 * free CARTO/OpenStreetMap map and search if it's rejected.
 */
let maptilerOk = true
const maptiler = () => !!env.maptilerKey && maptilerOk

export async function checkMapTiler(): Promise<'ok' | 'rejected' | 'unreachable' | 'none'> {
  if (!env.maptilerKey) return 'none'
  try {
    const res = await fetch(`https://api.maptiler.com/maps/streets-v2/256/0/0/0.png?key=${encodeURIComponent(env.maptilerKey)}`, { signal: AbortSignal.timeout(6000) })
    if (res.status === 401 || res.status === 403) {
      maptilerOk = false
      return 'rejected'
    }
    return res.ok ? 'ok' : 'unreachable'
  } catch {
    return 'unreachable'
  }
}

const CARTO_TILES = {
  url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png',
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
}

/**
 * `app`: the phone app asks, with `base` = this server's address as the app reached it.
 * CARTO and MapTiler only serve websites without a key ("API key required" on every tile for
 * an app), so the app gets its street map through RideSync (see basemap.ts).
 */
export function mapsConfig({ app = false, base = '' } = {}) {
  const google = googleConfigured() && !env.google.routesOnly
  return {
    google: google && env.google.display && env.google.browserKey ? { browserKey: env.google.browserKey } : null,
    tiles: app
      ? { url: `${base}/api/tiles/{z}/{x}/{y}.png`, attribution: basemapAttribution() }
      : maptiler()
      ? {
          url: `https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}{r}.png?key=${env.maptilerKey}`,
          attribution: '© <a href="https://www.maptiler.com/copyright/">MapTiler</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }
      : CARTO_TILES,
    // Sharp vector map with 3D buildings on the website.
    vectorStyle: maptiler() ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${env.maptilerKey}` : 'https://tiles.openfreemap.org/styles/liberty',
    // Ola Maps' Indian map style first when there's an Ola key; the one above if it can't load.
    vectorStyles: [
      ...(olaConfigured() && olaHasKey() ? ['https://api.olamaps.io/tiles/vector/v1/styles/default-light-standard/style.json'] : []),
      maptiler() ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${env.maptilerKey}` : 'https://tiles.openfreemap.org/styles/liberty',
    ],
    /** Ola Maps loads its map pieces in the browser, so it needs the key there (restrict it in the Ola dashboard). */
    olaKey: olaConfigured() && olaHasKey() ? env.olaKey : null,
    search: google ? 'google' : olaConfigured() ? 'ola' : maptiler() ? 'maptiler' : 'openstreetmap',
    routing: google ? 'google' : tomtomConfigured() ? 'tomtom' : env.orsKey ? 'openrouteservice' : 'osrm',
    /** Live traffic layer: tiles come from /api/traffic/{z}/{x}/{y}.png */
    traffic: tomtomConfigured(),
  }
}

const cache = new Map<string, { at: number; places: Place[] }>()
const UA = 'RideSync/1.0 (college carpooling app)'
// Mumbai metropolitan region, biased to campus.
const BBOX = '72.6,18.8,73.3,19.5'

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 5000)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'en', ...headers } })
    if (!res.ok) throw new Error(`maps ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(t)
  }
}

type MTFeature = { id: string; text: string; place_name: string; center: [number, number] }
type NomRow = { place_id: number; lat: string; lon: string; name?: string; display_name: string }

const short = (full: string, name: string) =>
  full
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== name)
    .slice(0, 2)
    .join(', ')

export async function searchPlaces(q: string, sessionToken?: string): Promise<Place[]> {
  const key = q.trim().toLowerCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 3600_000) return hit.places
  let places: Place[] = []
  if (googleConfigured() && !env.google.routesOnly) {
    try {
      places = await googleAutocomplete(q, sessionToken)
      cache.set(key, { at: Date.now(), places })
      return places
    } catch (e) {
      console.error('[ridesync] Google place search failed, using OpenStreetMap', (e as Error).message)
    }
  }
  if (olaConfigured()) {
    try {
      places = await olaSearch(q, CAMPUS)
      if (places.length) {
        cache.set(key, { at: Date.now(), places })
        return places
      }
    } catch (e) {
      console.error('[ridesync] Ola Maps search failed, using the next service', (e as Error).message)
    }
  }
  if (maptiler()) {
    try {
      const data = await getJson<{ features: MTFeature[] }>(
        `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?key=${env.maptilerKey}&country=in&bbox=${BBOX}&proximity=${CAMPUS.lng},${CAMPUS.lat}&limit=6&language=en`,
      )
      places = data.features.map((f) => ({ id: `mt-${f.id}`, name: f.text, area: short(f.place_name, f.text), lat: f.center[1], lng: f.center[0], kind: 'custom' as const }))
      cache.set(key, { at: Date.now(), places })
      return places
    } catch (e) {
      console.error('[ridesync] MapTiler search failed, using OpenStreetMap', (e as Error).message)
    }
  }
  try {
    {
      const rows = await getJson<NomRow[]>(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=in&viewbox=${BBOX}&bounded=1&q=${encodeURIComponent(q)}`)
      places = rows.map((r) => {
        const name = r.name || r.display_name.split(',')[0]
        return { id: `osm-${r.place_id}`, name, area: short(r.display_name, name), lat: Number(r.lat), lng: Number(r.lon), kind: 'custom' as const }
      })
    }
  } catch (e) {
    console.error('[ridesync] place search failed', (e as Error).message)
    return []
  }
  if (cache.size > 2000) cache.clear()
  cache.set(key, { at: Date.now(), places })
  return places
}


/** Coordinates for a Google suggestion the student picked. */
export async function resolvePlace(placeId: string, sessionToken?: string): Promise<Place> {
  return googlePlaceDetails(placeId, sessionToken)
}

const names = new Map<string, { at: number; r: { name: string; area: string } }>()

/**
 * Human-readable name for coordinates, best first:
 * Google → Ola Maps → TomTom nearby places → MapTiler → OpenStreetMap.
 * Results are kept for a day per ~1 m spot so dragging the pin back doesn't use quota.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<{ name: string; area: string } | null> {
  const k = `${lat.toFixed(5)},${lng.toFixed(5)}`
  const hit = names.get(k)
  if (hit && Date.now() - hit.at < 86_400_000) return hit.r
  const r = await lookupName(lat, lng)
  if (r) {
    if (names.size > 5000) names.clear()
    names.set(k, { at: Date.now(), r })
  }
  return r
}

async function lookupName(lat: number, lng: number): Promise<{ name: string; area: string } | null> {
  if (googleConfigured() && !env.google.routesOnly) {
    try {
      const r = await googleReverse(lat, lng)
      if (r) return r
    } catch (e) {
      console.error('[ridesync] Google place name failed, using OpenStreetMap', (e as Error).message)
    }
  }
  if (olaConfigured()) {
    const r = await olaReverse(lat, lng)
    if (r) return r
  }
  const tt = await tomtomNearby(lat, lng)
  if (tt) return tt
  if (maptiler()) {
    try {
      const data = await getJson<{ features: (MTFeature & { place_type?: string[] })[] }>(
        `https://api.maptiler.com/geocoding/${lng},${lat}.json?key=${env.maptilerKey}&limit=5&language=en&types=poi,address,neighbourhood,locality`,
      )
      // Prefer a building/landmark, then a street address, then the neighbourhood — not a highway.
      const rank = (f: { place_type?: string[]; text: string }) =>
        (f.place_type?.includes('poi') ? 0 : f.place_type?.includes('address') ? 1 : 2) + (isHighway(f.text) ? 5 : 0)
      const f = [...data.features].sort((x, y) => rank(x) - rank(y))[0]
      if (f) return { name: f.text, area: short(f.place_name, f.text) }
    } catch (e) {
      console.error('[ridesync] MapTiler place name failed, using OpenStreetMap', (e as Error).message)
    }
  }
  try {
    const r = await getJson<{ name?: string; display_name?: string; address?: Record<string, string> }>(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat}&lon=${lng}`,
    )
    if (!r.display_name) return null
    const a = r.address ?? {}
    const area = a.neighbourhood || a.suburb || a.quarter || a.residential
    const city = a.city || a.town || a.village || a.state_district
    // Building or landmark names first; a bare highway name (e.g. "NH 48") is replaced by the area.
    const building = a.building || a.amenity || a.house_name || a.shop || a.office || a.school || a.college || a.university || a.hospital || a.tourism || a.leisure
    const own = r.name && r.name !== a.road && !isHighway(r.name) ? r.name : undefined
    const street = a.road && !isHighway(a.road) ? [a.house_number, a.road].filter(Boolean).join(' ') : undefined
    const name = building || own || street || (area ? `Near ${area}` : r.display_name.split(',')[0])
    return { name, area: [area, city].filter((x) => x && !name.includes(x)).join(', ') }
  } catch {
    return null
  }
}
