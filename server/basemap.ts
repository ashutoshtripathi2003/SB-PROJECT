import { env } from './env'
import { tomtomConfigured } from './traffic'

/**
 * Street map pictures for the phone app, served by RideSync itself (/api/tiles/{z}/{x}/{y}.png).
 *
 * Free map services only serve websites without a key (CARTO and MapTiler draw "API key required"
 * on tiles an app asks for), so the server fetches the tiles with its own keys and passes them on:
 *   1. TomTom map   (TOMTOM_KEY — the same key as live traffic; free plan has 50,000 tiles a day)
 *   2. MapTiler     (MAPTILER_KEY, when its key isn't limited to websites)
 *   3. OpenStreetMap (no key; light use only, which the cache below keeps it to)
 * A service that refuses or fails is skipped for 10 minutes. Tiles are cached for a week.
 */

type Source = { name: string; url: (z: number, x: number, y: number) => string; attribution: string }

const SOURCES: Source[] = [
  {
    name: 'tomtom',
    url: (z, x, y) => `https://api.tomtom.com/map/1/tile/basic/main/${z}/${x}/${y}.png?key=${encodeURIComponent(env.tomtomKey)}&tileSize=256&view=IN`,
    attribution: '© TomTom © OpenStreetMap',
  },
  {
    name: 'maptiler',
    url: (z, x, y) => `https://api.maptiler.com/maps/streets-v2/256/${z}/${x}/${y}.png?key=${encodeURIComponent(env.maptilerKey)}`,
    attribution: '© MapTiler © OpenStreetMap',
  },
  { name: 'osm', url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, attribution: '© OpenStreetMap contributors' },
]

const configured = (s: Source) => (s.name === 'tomtom' ? tomtomConfigured() : s.name === 'maptiler' ? !!env.maptilerKey : true)
const pausedUntil = new Map<string, number>()
const available = () => SOURCES.filter((s) => configured(s) && (pausedUntil.get(s.name) ?? 0) < Date.now())

const WEEK = 7 * 86_400_000
const cache = new Map<string, { at: number; body: Buffer; source: string }>()
const UA = 'RideSync/1.0 (college carpooling app)'

/** Credit line for the map that's in use right now. */
export const basemapAttribution = () => (available()[0] ?? SOURCES[2]).attribution

export async function basemapTile(z: number, x: number, y: number): Promise<{ body: Buffer; source: string } | null> {
  const k = `${z}/${x}/${y}`
  const hit = cache.get(k)
  if (hit && Date.now() - hit.at < WEEK) {
    // Refresh recency so busy tiles stay cached.
    cache.delete(k)
    cache.set(k, hit)
    return hit
  }
  for (const s of available()) {
    try {
      const res = await fetch(s.url(z, x, y), { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': UA } })
      if (!res.ok || !String(res.headers.get('content-type')).startsWith('image/')) {
        if ([401, 403, 429].includes(res.status) || res.status >= 500) {
          if ((pausedUntil.get(s.name) ?? 0) < Date.now()) console.log(`[ridesync] phone app map: ${NAMES[s.name]} refused (${res.status}) — trying the next map for 10 minutes`)
          pausedUntil.set(s.name, Date.now() + 10 * 60_000)
        }
        continue
      }
      const out = { at: Date.now(), body: Buffer.from(await res.arrayBuffer()), source: s.name }
      if (cache.size >= 4000) cache.delete(cache.keys().next().value!)
      cache.set(k, out)
      return out
    } catch {
      pausedUntil.set(s.name, Date.now() + 60_000)
    }
  }
  return null
}

const NAMES: Record<string, string> = { tomtom: 'TomTom', maptiler: 'MapTiler', osm: 'OpenStreetMap' }

/** Startup check: asks every map service for one Mumbai tile and says what each one answered. */
export async function checkBasemap(): Promise<string> {
  const results = await Promise.all(
    SOURCES.filter(configured).map(async (s) => {
      try {
        const res = await fetch(s.url(12, 2886, 1838), { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': UA } })
        const ok = res.ok && String(res.headers.get('content-type')).startsWith('image/')
        const hint = res.status === 401 || res.status === 403 ? ' — key refused' : res.status === 429 ? ' — daily limit reached' : ''
        return `${NAMES[s.name]} ${ok ? '✓' : `✗ (${res.status}${hint})`}`
      } catch (e) {
        return `${NAMES[s.name]} ✗ (${(e as Error).name === 'TimeoutError' ? 'no answer' : 'can’t connect'})`
      }
    }),
  )
  return results.join(' · ')
}

/** For tests. */
export function resetBasemap() {
  cache.clear()
  pausedUntil.clear()
}
