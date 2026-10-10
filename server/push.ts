import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SignJWT, importPKCS8 } from 'jose'
import { all, db, run } from './db'

/**
 * Phone notifications (the notification bar, even when the app is closed) through Firebase
 * Cloud Messaging — the same system Ola and Uber use.
 *
 * Setup (free): Firebase console → Project settings → Service accounts → Generate new private key,
 * save the file as firebase-key.json in the RideSync folder (next to .env). It's a secret: never
 * share or commit it. Without it everything works as before, just without phone notifications.
 */

db.exec(`
CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS push_tokens_user ON push_tokens(user_id);
`)

type ServiceAccount = { project_id: string; client_email: string; private_key: string; token_uri?: string }

const keyFile = () => resolve(process.env.FIREBASE_KEY_FILE || 'firebase-key.json')
let account: ServiceAccount | null | undefined

function serviceAccount(): ServiceAccount | null {
  if (account !== undefined) return account
  account = null
  try {
    const raw = process.env.FIREBASE_KEY_JSON || (existsSync(keyFile()) ? readFileSync(keyFile(), 'utf8') : '')
    if (raw) {
      const j = JSON.parse(raw) as ServiceAccount
      if (j.project_id && j.client_email && j.private_key) account = j
    }
  } catch {
    account = null
  }
  return account
}

export const pushConfigured = () => !!serviceAccount()
export const pushProject = () => serviceAccount()?.project_id ?? null

let cached: { token: string; until: number } | null = null

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token
  const aud = sa.token_uri || 'https://oauth2.googleapis.com/token'
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(await importPKCS8(sa.private_key, 'RS256'))
  const res = await fetch(aud, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Firebase sign-in failed (${res.status})`)
  const j = (await res.json()) as { access_token: string; expires_in?: number }
  cached = { token: j.access_token, until: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 300) * 1000 }
  return j.access_token
}

export function savePushToken(userId: string, token: string, platform: string) {
  run(
    `INSERT INTO push_tokens (token, user_id, platform, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, updated_at = excluded.updated_at`,
    token,
    userId,
    platform,
    new Date().toISOString(),
  )
}

export function removePushToken(token: string, userId?: string) {
  if (userId) run(`DELETE FROM push_tokens WHERE token = ? AND user_id = ?`, token, userId)
  else run(`DELETE FROM push_tokens WHERE token = ?`, token)
}

/** Send a notification to every phone the user is signed in on. Never throws. */
export async function sendPush(userId: string, msg: { title: string; body: string; link?: string; kind?: string }): Promise<number> {
  const sa = serviceAccount()
  if (!sa) return 0
  const tokens = all<{ token: string }>(`SELECT token FROM push_tokens WHERE user_id = ?`, userId).map((t) => t.token)
  if (!tokens.length) return 0
  let sent = 0
  try {
    const bearer = await accessToken(sa)
    await Promise.all(
      tokens.map(async (token) => {
        const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
          method: 'POST',
          headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: msg.title, body: msg.body },
              data: { link: msg.link ?? '', kind: msg.kind ?? '' },
              android: { priority: 'HIGH', notification: { channel_id: 'rides', sound: 'default' } },
              apns: { payload: { aps: { sound: 'default' } } },
            },
          }),
          signal: AbortSignal.timeout(10_000),
        }).catch(() => null)
        if (!res) return
        if (res.ok) return void sent++
        // The app was uninstalled or the phone signed out: forget that address.
        const text = await res.text().catch(() => '')
        if (res.status === 404 || /UNREGISTERED|registration token is not a valid/i.test(text)) removePushToken(token)
      }),
    )
  } catch (e) {
    console.log(`[ridesync] phone notification not sent: ${(e as Error).message}`)
  }
  return sent
}

/** For tests. */
export function resetPush() {
  account = undefined
  cached = null
}
