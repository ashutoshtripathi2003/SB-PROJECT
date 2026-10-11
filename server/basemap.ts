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
 * A refusing service is skipped for a while (refused key 10 min, burst limit 20 s); at most 6 fetches
 * run at once so zooming doesn't trip the free plans' burst limits. Tiles are cached for a week.
 */

type Source = { name: string; url: (z: number, x: number, y: number, hi?: boolean) => string; attribution: string }

const SOURCES: Source[] = [
  {
    name: 'tomtom',
    url: (z, x, y, hi) => `https://api.tomtom.com/map/1/tile/basic/main/${z}/${x}/${y}.png?key=${encodeURIComponent(env.tomtomKey)}&tileSize=${hi ? 512 : 256}&view=IN`,
    attribution: '© TomTom © OpenStreetMap',
  },
  {
    name: 'maptiler',
    url: (z, x, y, hi) => `https://api.maptiler.com/maps/streets-v2/256/${z}/${x}/${y}${hi ? '@2x' : ''}.png?key=${encodeURIComponent(env.maptilerKey)}`,
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

/** `hi`: a sharp 512-pixel tile for high-density phone screens (one request instead of four small ones). */
export async function basemapTile(z: number, x: number, y: number, hi = false): Promise<{ body: Buffer; source: string } | null> {
  const k = `${z}/${x}/${y}${hi ? '@2x' : ''}`
  const hit = cache.get(k)
  if (hit && Date.now() - hit.at < WEEK) {
    // Refresh recency so busy tiles stay cached.
    cache.delete(k)
    cache.set(k, hit)
    return hit
  }
  // The same tile asked for twice at once (zooming, two phones) is fetched once.
  const running = inflight.get(k)
  if (running) return running
  const job = fetchTile(z, x, y, hi, k).finally(() => inflight.delete(k))
  inflight.set(k, job)
  return job
}

const inflight = new Map<string, Promise<{ body: Buffer; source: string } | null>>()

/*
 * Zooming asks for dozens of tiles at once; free map plans answer bursts with 429 "too many requests".
 * At most MAX_ACTIVE upstream fetches run together, the rest wait their turn (the phone just sees a tile
 * arrive a moment later instead of a failure).
 */
const MAX_ACTIVE = 6
let active = 0
const waiting: (() => void)[] = []
const takeSlot = () => (active < MAX_ACTIVE ? (active++, Promise.resolve()) : new Promise<void>((r) => waiting.push(r)))
const freeSlot = () => {
  const next = waiting.shift()
  if (next) next()
  else active--
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A refusing service is skipped for a while: a refused key for 10 minutes, a burst limit for 20 seconds. */
function pause(name: string, status: number) {
  const ms = status === 401 || status === 403 ? 10 * 60_000 : status === 429 ? 20_000 : status >= 500 ? 30_000 : 0
  if (!ms) return
  if ((pausedUntil.get(name) ?? 0) < Date.now())
    console.log(`[ridesync] phone app map: ${NAMES[name]} ${status === 429 ? 'busy (too many requests)' : `refused (${status})`} — using the next map for ${ms >= 60_000 ? `${ms / 60_000} minutes` : `${ms / 1000} seconds`}`)
  pausedUntil.set(name, Date.now() + ms)
}

async function fetchTile(z: number, x: number, y: number, hi: boolean, k: string): Promise<{ body: Buffer; source: string } | null> {
  await takeSlot()
  try {
    for (const s of available()) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch(s.url(z, x, y, hi), { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': UA } })
          if (res.ok && String(res.headers.get('content-type')).startsWith('image/')) {
            const out = { at: Date.now(), body: Buffer.from(await res.arrayBuffer()), source: s.name }
            if (cache.size >= 4000) cache.delete(cache.keys().next().value!)
            cache.set(k, out)
            return out
          }
          // One quick retry on a burst limit before moving on.
          if (res.status === 429 && attempt === 0) {
            await sleep(700)
            continue
          }
          pause(s.name, res.status)
        } catch {
          pausedUntil.set(s.name, Date.now() + 15_000)
        }
        break
      }
    }
    return null
  } finally {
    freeSlot()
  }
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
