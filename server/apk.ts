import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { env } from './env'

/**
 * The Android app for the /download page, served by RideSync itself.
 *
 * GitHub builds the app on every change (release "app-latest"). The server keeps a copy in data/apk and
 * checks for a newer one every 30 minutes, so the download keeps working when the repository is private
 * (set GITHUB_TOKEN to a read-only token then) and people never need a GitHub link.
 */

export const APK_FILES = ['RideSync-small.apk', 'RideSync.apk'] as const
export type ApkFile = (typeof APK_FILES)[number]

type Saved = { name: ApkFile; size: number; updatedAt: string }
type Info = { commit: string; publishedAt: string; files: Saved[]; checkedAt: string; error?: string }

const DIR = env.databasePath === ':memory:' ? '' : join(dirname(env.databasePath), 'apk')
const META = () => join(DIR, 'latest.json')

let info: Info | null = null
function load(): Info | null {
  if (info || !DIR) return info
  try {
    info = JSON.parse(readFileSync(META(), 'utf8')) as Info
  } catch {
    /* nothing downloaded yet */
  }
  return info
}

/** What the /download page shows. */
export function apkInfo() {
  const i = load()
  const files = (i?.files ?? []).filter((f) => existsSync(apkPath(f.name)))
  return { ready: files.length > 0, commit: i?.commit?.slice(0, 7) ?? null, publishedAt: i?.publishedAt ?? null, files: files.map((f) => ({ name: f.name, size: f.size })) }
}

export const apkPath = (name: ApkFile) => join(DIR, name)

type Asset = { name: string; url: string; size: number; updated_at: string }
type Release = { target_commitish: string; published_at: string; assets: Asset[] }

const headers = (accept: string) => ({ Accept: accept, 'User-Agent': 'RideSync', 'X-GitHub-Api-Version': '2022-11-28', ...(env.githubToken ? { Authorization: `Bearer ${env.githubToken}` } : {}) })

/** Download the newest app from GitHub when it changed. Returns a short line for the log. */
export async function refreshApk(): Promise<string> {
  if (!DIR) return 'off'
  const res = await fetch(`https://api.github.com/repos/${env.githubRepo}/releases/tags/app-latest`, { headers: headers('application/vnd.github+json'), signal: AbortSignal.timeout(15_000) })
  if (!res.ok) {
    const why = res.status === 404 ? (env.githubToken ? 'release not found, or the token can’t read the repository' : 'not found — if the repository is private, add GITHUB_TOKEN to .env') : `GitHub answered ${res.status}`
    throw new Error(why)
  }
  const rel = (await res.json()) as Release
  mkdirSync(DIR, { recursive: true })
  const old = load()
  const files: Saved[] = []
  let fetched = 0
  for (const name of APK_FILES) {
    const a = rel.assets.find((x) => x.name === name)
    if (!a) continue
    const have = old?.files.find((f) => f.name === name)
    if (have && have.updatedAt === a.updated_at && existsSync(apkPath(name))) {
      files.push(have)
      continue
    }
    // The asset API answers with a redirect to the file (the token isn't sent on to the file host).
    const dl = await fetch(a.url, { headers: headers('application/octet-stream'), signal: AbortSignal.timeout(300_000) })
    if (!dl.ok) throw new Error(`couldn’t download ${name} (${dl.status})`)
    const body = Buffer.from(await dl.arrayBuffer())
    await writeFile(`${apkPath(name)}.part`, body)
    await rename(`${apkPath(name)}.part`, apkPath(name))
    files.push({ name, size: body.length, updatedAt: a.updated_at })
    fetched++
  }
  info = { commit: rel.target_commitish, publishedAt: rel.published_at, files, checkedAt: new Date().toISOString() }
  await writeFile(META(), JSON.stringify(info, null, 2))
  return fetched ? `downloaded the new app (${rel.target_commitish.slice(0, 7)})` : `up to date (${rel.target_commitish.slice(0, 7)})`
}
