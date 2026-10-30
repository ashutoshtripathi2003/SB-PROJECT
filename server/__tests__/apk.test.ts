import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'rs-apk-'))
process.env.DATABASE_PATH = join(dir, 'ridesync.db')
process.env.GITHUB_TOKEN = 'gh-token'

const { refreshApk, apkInfo, apkPath } = await import('../apk')
const app = (await import('../app')).createApp()
const realFetch = globalThis.fetch
afterAll(() => {
  globalThis.fetch = realFetch
  rmSync(dir, { recursive: true, force: true })
})

const release = (updated: string) => ({
  target_commitish: 'abcdef1234567890',
  published_at: '2026-10-30T08:31:01Z',
  assets: [
    { name: 'RideSync-small.apk', url: 'https://api.github.com/assets/1', size: 4, updated_at: updated },
    { name: 'RideSync.apk', url: 'https://api.github.com/assets/2', size: 4, updated_at: updated },
  ],
})

describe('Android app for /download', () => {
  it('keeps a copy of the latest app and only downloads it again when GitHub has a newer one', async () => {
    let updated = '2026-10-30T08:31:00Z'
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer gh-token')
      return url.includes('/releases/tags/app-latest') ? Response.json(release(updated)) : new Response(new Uint8Array([80, 75, 3, 4]))
    })
    globalThis.fetch = f as unknown as typeof fetch

    expect(await refreshApk()).toContain('downloaded')
    expect(f).toHaveBeenCalledTimes(3)
    expect([...readFileSync(apkPath('RideSync-small.apk'))]).toEqual([80, 75, 3, 4])
    expect(apkInfo()).toMatchObject({ ready: true, commit: 'abcdef1', files: [{ name: 'RideSync-small.apk', size: 4 }, { name: 'RideSync.apk', size: 4 }] })

    expect(await refreshApk()).toContain('up to date')
    expect(f).toHaveBeenCalledTimes(4)

    updated = '2026-10-31T09:00:00Z'
    expect(await refreshApk()).toContain('downloaded')
    expect(f).toHaveBeenCalledTimes(7)
    expect(existsSync(`${apkPath('RideSync.apk')}.part`)).toBe(false)
  })

  it('serves the app file and the page info', async () => {
    const res = await request(app).get('/download/RideSync-small.apk')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/vnd.android.package-archive')
    expect(res.headers['content-disposition']).toContain('RideSync-small.apk')
    expect((await request(app).get('/api/app/download')).body.ready).toBe(true)
    // Any other name is not a file download (the website's own page, or 404 without a build).
    expect(String((await request(app).get('/download/other.apk')).headers['content-type'])).not.toContain('android')
  })

  it('explains a private repository without a token', async () => {
    globalThis.fetch = vi.fn(async () => new Response('Not Found', { status: 404 })) as unknown as typeof fetch
    await expect(refreshApk()).rejects.toThrow(/release not found|GITHUB_TOKEN/)
  })
})
