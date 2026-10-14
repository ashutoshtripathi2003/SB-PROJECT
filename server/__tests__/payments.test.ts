import { createHmac } from 'node:crypto'
import request from 'supertest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_PATH = ':memory:'
process.env.DEV_LOGIN = 'true'
process.env.OSRM_URL = 'http://127.0.0.1:9'
process.env.RAZORPAY_KEY_ID = 'rzp_test_abc'
process.env.RAZORPAY_KEY_SECRET = 'secret123'
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec'

let app: Parameters<typeof request>[0]
const H = { 'x-ridesync': '1' }
const realFetch = globalThis.fetch
const campus = { id: 'vit-campus', name: 'VIT Wadala', area: 'Wadala', lat: 19.0222, lng: 72.8711, kind: 'campus' }
const malad = { id: 'malad', name: 'Malad', area: 'Malad Station', lat: 19.1868, lng: 72.8484, kind: 'station' }

type Call = { url: string; body: Record<string, unknown> }
let calls: Call[] = []
let orderSeq = 0
function mockRazorpay() {
  calls = []
  globalThis.fetch = vi.fn(async (u: unknown, init?: RequestInit) => {
    const url = String(u)
    if (!url.startsWith('https://api.razorpay.com')) return realFetch(u as string, init)
    const body = JSON.parse(String(init?.body ?? '{}'))
    calls.push({ url, body })
    if (url.endsWith('/orders')) return new Response(JSON.stringify({ id: `order_${++orderSeq}`, amount: body.amount, currency: 'INR' }), { status: 200 })
    if (url.includes('/refund')) return new Response(JSON.stringify({ id: 'rfnd_1', status: 'processed' }), { status: 200 })
    return new Response('{}', { status: 404 })
  }) as typeof fetch
}
afterEach(() => {
  globalThis.fetch = realFetch
})

beforeAll(async () => {
  app = (await import('../app')).createApp()
})

let phoneSeq = 0
async function user(email: string, sid: string, extra: Record<string, unknown> = {}) {
  const agent = request.agent(app)
  await agent.post('/api/auth/dev').set(H).send({ email })
  const r = await agent.patch('/api/me').set(H).send({ phone: `98765${String(++phoneSeq).padStart(5, '0')}`, studentId: sid, onboarded: true, ...extra })
  if (r.status !== 200) throw new Error(`onboarding failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`)
  return agent
}

async function acceptedBooking(tag: string) {
  const driver = await user(`driver.${tag}@vit.edu.in`, `D${tag}0001`)
  await driver.put('/api/me/vehicle').set(H).send({ make: 'Honda', model: 'City', color: 'White', plate: 'MH01AB1234', seats: 3, fuel: 'petrol' })
  const departAt = new Date(Date.now() + 3 * 3600_000).toISOString()
  const ride = (await driver.post('/api/rides').set(H).send({ origin: campus, destination: malad, departAt, seats: 3, farePerSeat: 80, maxDetourKm: 3, preferences: [] })).body
  const rider = await user(`rider.${tag}@vit.edu.in`, `R${tag}0001`)
  const query = { pickup: campus, drop: malad, date: departAt.slice(0, 10), time: '00:00', at: departAt, seats: 1, preferences: [] }
  const booking = (await rider.post('/api/bookings').set(H).send({ rideId: ride.id, query })).body
  await driver.post(`/api/bookings/${booking.id}/respond`).set(H).send({ accept: true })
  // The fixed seat price (an older live-split ride would take its guaranteed maximum instead).
  const b = (await rider.get(`/api/bookings/${booking.id}`)).body.booking
  const max = (b.fareMax ?? b.fare) as number
  return { driver, rider, ride, booking, max }
}

const sign = (s: string, key: string) => createHmac('sha256', key).update(s).digest('hex')

describe('Razorpay online payments', () => {
  it('exposes the public key id only', async () => {
    const cfg = (await request(app).get('/api/config')).body
    expect(cfg.razorpayKeyId).toBe('rzp_test_abc')
    expect(JSON.stringify(cfg)).not.toContain('secret123')
  })

  it('creates an order for the booking amount and confirms after signature verification', async () => {
    mockRazorpay()
    const { rider, driver, booking, max } = await acceptedBooking('a')
    const order = await rider.post(`/api/bookings/${booking.id}/pay/online`).set(H).send({})
    expect(order.status).toBe(200)
    expect(order.body).toMatchObject({ keyId: 'rzp_test_abc', amount: max * 100, currency: 'INR' })
    expect(calls[0].body).toMatchObject({ amount: max * 100, currency: 'INR' })
    // Driver can't create the rider's order.
    expect((await driver.post(`/api/bookings/${booking.id}/pay/online`).set(H).send({})).status).toBe(403)

    const bad = await rider.post(`/api/bookings/${booking.id}/pay/online/verify`).set(H).send({ razorpay_order_id: order.body.orderId, razorpay_payment_id: 'pay_1', razorpay_signature: 'forged' })
    expect(bad.status).toBe(400)
    const wrongOrder = await rider.post(`/api/bookings/${booking.id}/pay/online/verify`).set(H).send({ razorpay_order_id: 'order_other', razorpay_payment_id: 'pay_1', razorpay_signature: sign('order_other|pay_1', 'secret123') })
    expect(wrongOrder.status).toBe(400)

    const ok = await rider.post(`/api/bookings/${booking.id}/pay/online/verify`).set(H).send({ razorpay_order_id: order.body.orderId, razorpay_payment_id: 'pay_1', razorpay_signature: sign(`${order.body.orderId}|pay_1`, 'secret123') })
    expect(ok.status).toBe(200)
    const det = (await rider.get(`/api/bookings/${booking.id}`)).body.booking
    expect(det).toMatchObject({ status: 'confirmed', paymentMethod: 'online', paymentStatus: 'paid_online', paymentRef: 'pay_1' })
    // Can't switch to cash/UPI after paying online, or pay twice.
    expect((await rider.post(`/api/bookings/${booking.id}/pay`).set(H).send({ method: 'cash' })).status).toBe(409)
    expect((await rider.post(`/api/bookings/${booking.id}/pay/online`).set(H).send({})).status).toBe(409)
    expect((await driver.get('/api/notifications')).body[0].title).toMatch(/paid online/)
  })

  it('confirms through the webhook if the rider closed the tab, and rejects bad webhook signatures', async () => {
    mockRazorpay()
    const { rider, booking } = await acceptedBooking('b')
    const order = (await rider.post(`/api/bookings/${booking.id}/pay/online`).set(H).send({})).body
    const payload = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_wh', order_id: order.orderId } } } })
    const forged = await request(app).post('/api/payments/razorpay/webhook').set('x-razorpay-signature', 'nope').set('Content-Type', 'application/json').send(payload)
    expect(forged.status).toBe(400)
    const okHook = await request(app).post('/api/payments/razorpay/webhook').set('x-razorpay-signature', sign(payload, 'whsec')).set('Content-Type', 'application/json').send(payload)
    expect(okHook.status).toBe(200)
    expect((await rider.get(`/api/bookings/${booking.id}`)).body.booking).toMatchObject({ status: 'confirmed', paymentStatus: 'paid_online', paymentRef: 'pay_wh' })
  })

  it('refunds automatically when the driver cancels the ride', async () => {
    mockRazorpay()
    const { rider, driver, ride, booking, max } = await acceptedBooking('c')
    const order = (await rider.post(`/api/bookings/${booking.id}/pay/online`).set(H).send({})).body
    await rider.post(`/api/bookings/${booking.id}/pay/online/verify`).set(H).send({ razorpay_order_id: order.orderId, razorpay_payment_id: 'pay_c', razorpay_signature: sign(`${order.orderId}|pay_c`, 'secret123') })
    expect((await driver.post(`/api/rides/${ride.id}/cancel`).set(H).send({ reason: 'Car trouble' })).status).toBe(200)
    const refund = calls.find((c) => c.url.includes('/payments/pay_c/refund'))
    expect(refund?.body).toMatchObject({ amount: max * 100 })
    expect((await rider.get(`/api/bookings/${booking.id}`)).body.booking).toMatchObject({ status: 'cancelled', paymentStatus: 'refunded' })
    expect((await rider.get('/api/notifications')).body.map((n: { title: string }) => n.title)).toContain('Refund started')
  })

  it('refunds when the rider cancels their own seat', async () => {
    mockRazorpay()
    const { rider, booking } = await acceptedBooking('d')
    const order = (await rider.post(`/api/bookings/${booking.id}/pay/online`).set(H).send({})).body
    await rider.post(`/api/bookings/${booking.id}/pay/online/verify`).set(H).send({ razorpay_order_id: order.orderId, razorpay_payment_id: 'pay_d', razorpay_signature: sign(`${order.orderId}|pay_d`, 'secret123') })
    expect((await rider.post(`/api/bookings/${booking.id}/cancel`).set(H).send({ reason: 'Plans changed' })).status).toBe(200)
    expect(calls.some((c) => c.url.includes('/payments/pay_d/refund'))).toBe(true)
    expect((await rider.get(`/api/bookings/${booking.id}`)).body.booking.paymentStatus).toBe('refunded')
  })
})

describe('place search', () => {
  it('ignores very short queries and requires login', async () => {
    expect((await request(app).get('/api/places?q=dadar')).status).toBe(401)
    const a = await user('places.user@vit.edu.in', 'P0000001')
    expect((await a.get('/api/places?q=ab')).body).toEqual([])
    expect((await a.get('/api/places/reverse?lat=999&lng=1')).status).toBe(400)
  })
})

describe('RideSync Wallet', () => {
  it('adds money through Razorpay, pays a ride, and refunds to the wallet on cancel', async () => {
    mockRazorpay()
    const { rider, driver, booking, max } = await acceptedBooking('w')
    expect((await rider.get('/api/wallet').set(H)).body).toMatchObject({ balance: 0, testMode: true, canTopUp: true })

    // Not enough money yet.
    expect((await rider.post(`/api/bookings/${booking.id}/pay/wallet`).set(H)).status).toBe(402)

    const order = await rider.post('/api/wallet/topup').set(H).send({ amount: 200 })
    expect(order.status).toBe(200)
    expect(order.body.amount).toBe(20000)
    // A forged signature doesn't credit anything.
    const bad = await rider.post('/api/wallet/topup/verify').set(H).send({ razorpay_order_id: order.body.orderId, razorpay_payment_id: 'pay_x', razorpay_signature: 'nope' })
    expect(bad.status).toBe(400)
    // Someone else can't claim the top-up.
    const other = await driver.post('/api/wallet/topup/verify').set(H).send({ razorpay_order_id: order.body.orderId, razorpay_payment_id: 'pay_w1', razorpay_signature: sign(`${order.body.orderId}|pay_w1`, 'secret123') })
    expect(other.status).toBe(404)
    const ok = await rider.post('/api/wallet/topup/verify').set(H).send({ razorpay_order_id: order.body.orderId, razorpay_payment_id: 'pay_w1', razorpay_signature: sign(`${order.body.orderId}|pay_w1`, 'secret123') })
    expect(ok.body).toMatchObject({ ok: true, balance: 200 })
    // Verifying twice doesn't double-credit.
    await rider.post('/api/wallet/topup/verify').set(H).send({ razorpay_order_id: order.body.orderId, razorpay_payment_id: 'pay_w1', razorpay_signature: sign(`${order.body.orderId}|pay_w1`, 'secret123') })
    expect((await rider.get('/api/wallet').set(H)).body.balance).toBe(200)

    const paid = await rider.post(`/api/bookings/${booking.id}/pay/wallet`).set(H)
    expect(paid.body).toMatchObject({ ok: true, balance: 200 - max })
    expect((await driver.get('/api/wallet').set(H)).body.balance).toBe(max)
    expect((await rider.post(`/api/bookings/${booking.id}/pay/wallet`).set(H)).status).toBe(409)
    const b = (await rider.get(`/api/bookings/${booking.id}`).set(H)).body.booking
    expect(b).toMatchObject({ status: 'confirmed', paymentMethod: 'wallet', paymentStatus: 'paid_online' })

    const refundCalls = calls.filter((c) => c.url.includes('/refund')).length
    expect((await rider.post(`/api/bookings/${booking.id}/cancel`).set(H).send({ reason: 'My plans changed' })).status).toBe(200)
    expect((await rider.get('/api/wallet').set(H)).body.balance).toBe(200)
    expect((await driver.get('/api/wallet').set(H)).body.balance).toBe(0)
    expect(calls.filter((c) => c.url.includes('/refund')).length).toBe(refundCalls) // no gateway refund for wallet money
    expect((await rider.get(`/api/bookings/${booking.id}`).set(H)).body.booking.paymentStatus).toBe('refunded')
  })

  it('credits a top-up from the webhook too', async () => {
    mockRazorpay()
    const rider = await user('hook.w@vit.edu.in', 'RHW0001')
    const order = (await rider.post('/api/wallet/topup').set(H).send({ amount: 50 })).body
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_hook', order_id: order.orderId } } } })
    const res = await request(app).post('/api/payments/razorpay/webhook').set('content-type', 'application/json').set('x-razorpay-signature', sign(body, 'whsec')).send(body)
    expect(res.status).toBe(200)
    expect((await rider.get('/api/wallet').set(H)).body.balance).toBe(50)
  })
})
