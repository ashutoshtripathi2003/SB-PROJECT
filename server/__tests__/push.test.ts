import request from 'supertest'
import { exportPKCS8, generateKeyPair } from 'jose'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_PATH = ':memory:'
process.env.DEV_LOGIN = 'true'
process.env.ALLOWED_EMAIL_DOMAIN = 'vit.edu.in'

const H = { 'x-ridesync': '1', 'x-ridesync-app': '1' }
const TOKEN = 'fcm-token-'.padEnd(40, 'x')
let app: Parameters<typeof request>[0]
const realFetch = globalThis.fetch

beforeAll(async () => {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true })
  process.env.FIREBASE_KEY_JSON = JSON.stringify({ project_id: 'ridesync-test', client_email: 'push@ridesync-test.iam.gserviceaccount.com', private_key: await exportPKCS8(privateKey) })
  app = (await import('../app')).createApp()
})
afterEach(() => {
  globalThis.fetch = realFetch
})

function fakeFirebase(send: (body: Record<string, any>) => Response = () => Response.json({ name: 'projects/x/messages/1' })) {
  const sent: Record<string, any>[] = []
  globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'google-access', expires_in: 3600 })
    if (u.includes('fcm.googleapis.com')) {
      const body = JSON.parse(String(init?.body))
      sent.push({ url: u, auth: (init?.headers as Record<string, string>).authorization, ...body })
      return send(body)
    }
    return realFetch(url, init)
  }) as typeof fetch
  return sent
}

describe('phone notifications (Firebase)', () => {
  it('registers the phone, sends every notification to it, and stops after logout', async () => {
    const agent = request.agent(app)
    const { token } = (await agent.post('/api/auth/dev').set(H).send({ email: 'push.rider@vit.edu.in' })).body
    const auth = { ...H, authorization: `Bearer ${token}` }
    expect((await request(app).get('/api/config').set(H)).body.push).toBe(true)
    const reg = await request(app).post('/api/me/push-token').set(auth).send({ token: TOKEN, platform: 'android' })
    expect(reg.body).toEqual({ ok: true, push: true })

    const sent = fakeFirebase()
    const { notify } = await import('../logic')
    const { db } = await import('../db')
    const uid = String((db.prepare(`SELECT id FROM users WHERE email = ?`).get('push.rider@vit.edu.in') as { id: string }).id)
    notify(uid, 'accepted', 'Aarav accepted your request', 'Choose how you’ll pay ₹60', '/trip/b_1')
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].url).toBe('https://fcm.googleapis.com/v1/projects/ridesync-test/messages:send')
    expect(sent[0].auth).toBe('Bearer google-access')
    expect(sent[0].message).toMatchObject({
      token: TOKEN,
      notification: { title: 'Aarav accepted your request', body: 'Choose how you’ll pay ₹60' },
      data: { link: '/trip/b_1', kind: 'accepted' },
      android: { priority: 'HIGH', notification: { channel_id: 'rides' } },
    })

    await request(app).post('/api/auth/logout').set(auth).send({ pushToken: TOKEN })
    notify(uid, 'payment', 'x', 'y')
    await new Promise((r) => setTimeout(r, 50))
    expect(sent).toHaveLength(1)
  })

  it('forgets a phone that uninstalled the app', async () => {
    const { token } = (await request(app).post('/api/auth/dev').set(H).send({ email: 'push.gone@vit.edu.in' })).body
    await request(app).post('/api/me/push-token').set({ ...H, authorization: `Bearer ${token}` }).send({ token: TOKEN.replace('x', 'y'), platform: 'android' })
    const sent = fakeFirebase(() => Response.json({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }, { status: 404 }))
    const { sendPush } = await import('../push')
    const { db } = await import('../db')
    const uid = String((db.prepare(`SELECT id FROM users WHERE email = ?`).get('push.gone@vit.edu.in') as { id: string }).id)
    expect(await sendPush(uid, { title: 'a', body: 'b' })).toBe(0)
    expect(sent).toHaveLength(1)
    expect(db.prepare(`SELECT COUNT(*) n FROM push_tokens WHERE user_id = ?`).get(uid)).toMatchObject({ n: 0 })
  })

  it('needs a signed-in user', async () => {
    expect((await request(app).post('/api/me/push-token').set(H).send({ token: TOKEN, platform: 'android' })).status).toBe(401)
  })
})
