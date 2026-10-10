import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_PATH = ':memory:'
process.env.TOMTOM_KEY = 'tt-key'
process.env.MAPTILER_KEY = 'mt-key'

const { basemapTile, resetBasemap, basemapAttribution } = await import('../basemap')
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

  it('serves tiles over the API and tells the app the address it reached the server on', async () => {
    globalThis.fetch = vi.fn(async () => png()) as typeof fetch
    const res = await request(app).get('/api/tiles/12/2886/1838.png')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect((await request(app).get('/api/tiles/2/9/0.png')).status).toBe(404)
    // Every service down: a blank tile (not an error), so the app doesn't switch to a keyed map.
    globalThis.fetch = vi.fn(async () => new Response('down', { status: 503 })) as typeof fetch
    const blank = await request(app).get('/api/tiles/12/2887/1838.png')
    expect(blank.status).toBe(200)
    expect(blank.headers['cache-control']).toBe('no-store')
    const cfg = (await request(app).get('/api/config').set('x-ridesync-app', '1').set('Host', 'abc.trycloudflare.com').set('X-Forwarded-Proto', 'https')).body
    expect(cfg.maps.tiles.url).toBe('https://abc.trycloudflare.com/api/tiles/{z}/{x}/{y}.png')
  })
})
