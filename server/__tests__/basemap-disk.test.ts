import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'rs-tiles-'))
process.env.DATABASE_PATH = join(dir, 'ridesync.db')
process.env.TOMTOM_KEY = 'tt-key'

const { basemapTile, resetBasemap } = await import('../basemap')
const realFetch = globalThis.fetch
afterAll(() => {
  globalThis.fetch = realFetch
  rmSync(dir, { recursive: true, force: true })
})

describe('street map tiles on disk', () => {
  it('serves a saved tile after a restart without asking the map service again', async () => {
    const f = vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } }))
    globalThis.fetch = f as unknown as typeof fetch
    expect((await basemapTile(12, 2886, 1838, true))?.source).toBe('tomtom')
    await new Promise((r) => setTimeout(r, 50)) // the file is written in the background
    resetBasemap() // memory cleared, as after a deploy
    const again = await basemapTile(12, 2886, 1838, true)
    expect(again?.source).toBe('disk')
    expect([...again!.body]).toEqual([137, 80, 78, 71])
    expect(f).toHaveBeenCalledTimes(1)
  })
})
