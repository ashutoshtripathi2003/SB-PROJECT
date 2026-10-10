import { afterEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_PATH = ':memory:'
process.env.MAPTILER_KEY = 'wrong-key'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('MapTiler key check', () => {
  it('gives the phone app its street map through RideSync, never a keyed or website-only URL', async () => {
    const maps = await import('../maps')
    expect(maps.mapsConfig().tiles.url).toContain('api.maptiler.com')
    const app = maps.mapsConfig({ app: true, base: 'https://abc.trycloudflare.com' }).tiles.url
    expect(app).toBe('https://abc.trycloudflare.com/api/tiles/{z}/{x}/{y}.png')
  })

  it('falls back to the free map and search when MapTiler rejects the key', async () => {
    const maps = await import('../maps')
    expect(maps.mapsConfig().tiles.url).toContain('api.maptiler.com')
    globalThis.fetch = vi.fn(async () => new Response('Invalid key', { status: 403 })) as typeof fetch
    expect(await maps.checkMapTiler()).toBe('rejected')
    const cfg = maps.mapsConfig()
    expect(cfg.tiles.url).toContain('cartocdn.com')
    expect(cfg.search).toBe('openstreetmap')
  })
})
