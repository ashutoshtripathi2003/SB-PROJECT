import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'

process.env.DATABASE_PATH = ':memory:'
process.env.DEV_LOGIN = 'true'
process.env.SUPPORT_EMAIL = 'help@example.com'

let app: Parameters<typeof request>[0]
let db: typeof import('../db')
const H = { 'x-ridesync': '1' }
beforeAll(async () => {
  app = (await import('../app')).createApp()
  db = await import('../db')
})

describe('privacy', () => {
  it('shares the support address used by the Privacy Policy and Terms', async () => {
    const res = await request(app).get('/api/config')
    expect(res.body.supportEmail).toBe('help@example.com')
  })

  it('removes personal details, ID card and logins when an account is deleted', async () => {
    const a = request.agent(app)
    await a.post('/api/auth/dev').set(H).send({ email: 'leaving.student@vit.edu.in' })
    expect((await a.patch('/api/me').set(H).send({ name: 'Leaving Student', phone: '9876511111', studentId: 'VU1F2324999', upiId: 'leaving@okaxis', onboarded: true })).status).toBe(200)
    const me = (await a.get('/api/me')).body
    db.run(`UPDATE users SET id_card = 'data:image/jpeg;base64,AAAA', id_ocr = '{"name":"Leaving Student"}' WHERE id = ?`, me.id)
    db.run(`INSERT INTO push_tokens (token, user_id, platform, updated_at) VALUES ('tok-1', ?, 'android', ?)`, me.id, new Date().toISOString())

    expect((await a.delete('/api/me').set(H)).status).toBe(200)

    const row = db.one<Record<string, unknown>>(`SELECT * FROM users WHERE id = ?`, me.id)!
    expect(row.deleted).toBe(1)
    expect(row.email).toBe(`deleted+${me.id}@deleted.invalid`)
    expect(row.name).toBe('Deleted user')
    expect(row.phone).toBe('')
    expect(row.student_id).toBe('')
    expect(row.upi_id).toBeNull()
    expect(row.id_card).toBeNull()
    expect(row.id_ocr).toBeNull()
    expect(db.one(`SELECT 1 AS x FROM sessions WHERE user_id = ?`, me.id)).toBeUndefined()
    expect(db.one(`SELECT 1 AS x FROM push_tokens WHERE user_id = ?`, me.id)).toBeUndefined()
    expect((await a.get('/api/me')).status).toBe(401)
  })
})
