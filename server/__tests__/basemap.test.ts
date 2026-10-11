import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_PATH = ':memory:'
process.env.TOMTOM_KEY = 'tt-key'
process.env.MAPTILER_KEY = 'mt-key'

const { basemapTile, resetBasemap, basemapAttribution, checkBasemap } = await import('../basemap')
const app = (await import('../app')).createApp()
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  resetBasemap()
})

const png = () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } })

describe('street map for the phone app', () => {
  it('uses TomTom first and caches the tile', async () => {
    const f = vi.fn(async (_url: string) => png())
    globalThis.fetch = f as unknown as typeof fetch
    expect((await basemapTile(12, 2886, 1838))?.source).toBe('tomtom')
    expect((await basemapTile(12, 2886, 1838))?.source).toBe('tomtom')
    expect(f).toHaveBeenCalledTimes(1)
    expect(String(f.mock.calls[0][0])).toContain('api.tomtom.com/map/1/tile/basic/main/12/2886/1838.png')
    expect(basemapAttribution()).toContain('TomTom')
  })

  it('skips a service that refuses the key and uses the next one', async () => {
    const f = vi.fn(async (url: string) => (url.includes('tomtom') ? new Response('Forbidden', { status: 403 }) : url.includes('maptiler') ? new Response('Invalid key', { status: 403 }) : png()))
    globalThis.fetch = f as unknown as typeof fetch
    expect((await basemapTile(10, 721, 459))?.source).toBe('osm')
    expect(basemapAttribution()).toContain('OpenStreetMap')
    // Refusing services are paused, so the next tile goes straight to the one that works.
    f.mockClear()
    expect((await basemapTile(10, 722, 459))?.source).toBe('osm')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('retries TomTom once on a burst limit instead of dropping it', async () => {
    let n = 0
    globalThis.fetch = vi.fn(async (url: string) => (url.includes('tomtom') && n++ === 0 ? new Response('busy', { status: 429 }) : png())) as unknown as typeof fetch
    expect((await basemapTile(13, 5772, 3676))?.source).toBe('tomtom')
  })

  it('never runs more than 6 map fetches at once, and fetches a repeated tile once', async () => {
    let now = 0, peak = 0
    const f = vi.fn(async () => {
      peak = Math.max(peak, ++now)
      await new Promise((r) => setTimeout(r, 20))
      now--
      return png()
    })
    globalThis.fetch = f as unknown as typeof fetch
    const tiles = await Promise.all([...Array(20)].map((_, i) => basemapTile(14, 11500 + i, 7350)).concat([basemapTile(14, 11500, 7350)]))
    expect(tiles.every((t) => t?.source === 'tomtom')).toBe(true)
    expect(peak).toBeLessThanOrEqual(6)
    expect(f).toHaveBeenCalledTimes(20)
  })

  it('sends one sharp 512-pixel tile for @2x requests', async () => {
    const f = vi.fn(async (_url: string) => png())
    globalThis.fetch = f as unknown as typeof fetch
    expect((await request(app).get('/api/tiles/12/2886/1838@2x.png')).status).toBe(200)
    expect(String(f.mock.calls[0][0])).toContain('/12/2886/1838.png?')
    expect(String(f.mock.calls[0][0])).toContain('tileSize=512')
  })

  it('suggests TomTom places (buildings, shops) while typing', async () => {
    globalThis.fetch = vi.fn(async (url: string) =>
      url.includes('api.tomtom.com/search/2/search/')
        ? Response.json({ results: [{ id: 'a1', poi: { name: 'Phoenix Marketcity' }, address: { municipalitySubdivision: 'Kurla West', municipality: 'Mumbai' }, position: { lat: 19.0866, lon: 72.8888 } }] })
        : new Response('nope', { status: 500 }),
    ) as unknown as typeof fetch
    const { searchPlaces } = await import('../maps')
    const places = await searchPlaces('phoenix mark')
    expect(places[0]).toMatchObject({ name: 'Phoenix Marketcity', area: 'Kurla West, Mumbai', lat: 19.0866, lng: 72.8888 })
  })

  it('startup check says which map service works and which refuses', async () => {
    globalThis.fetch = vi.fn(async (url: string) => (url.includes('tomtom') ? new Response('Forbidden', { status: 403 }) : url.includes('maptiler') ? new Response('x', { status: 429 }) : png())) as unknown as typeof fetch
    expect(await checkBasemap()).toBe('TomTom ✗ (403 — key refused) · MapTiler ✗ (429 — daily limit reached) · OpenStreetMap ✓')
  })

  it('serves tiles over the API and tells the app the address it reached the server on', async () => {
    globalThis.fetch = vi.fn(async () => png()) as typeof fetch
    const res = await request(app).get('/api/tiles/12/2886/1838.png')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect((await request(app).get('/api/tiles/2/9/0.png')).status).toBe(404)
    // Every service down: an error the app retries when the map moves (not a blank square it keeps).
    globalThis.fetch = vi.fn(async () => new Response('down', { status: 503 })) as typeof fetch
    const down = await request(app).get('/api/tiles/12/2887/1838.png')
    expect(down.status).toBe(503)
    expect(down.headers['cache-control']).toBe('no-store')
    const cfg = (await request(app).get('/api/config').set('x-ridesync-app', '1').set('Host', 'abc.trycloudflare.com').set('X-Forwarded-Proto', 'https')).body
    expect(cfg.maps.tiles.url).toBe('https://abc.trycloudflare.com/api/tiles/{z}/{x}/{y}.png')
    // Tunnel link without the https hint still gets https (phones block http); Wi-Fi addresses keep http.
    const tunnel = (await request(app).get('/api/config').set('x-ridesync-app', '1').set('Host', 'xyz.trycloudflare.com')).body
    expect(tunnel.maps.tiles.url).toBe('https://xyz.trycloudflare.com/api/tiles/{z}/{x}/{y}.png')
    const wifi = (await request(app).get('/api/config').set('x-ridesync-app', '1').set('Host', '192.168.1.5:5173')).body
    expect(wifi.maps.tiles.url).toBe('http://192.168.1.5:5173/api/tiles/{z}/{x}/{y}.png')
  })
})
