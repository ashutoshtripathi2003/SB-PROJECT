import request from 'supertest'
import { beforeAll, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_PATH = ':memory:'
process.env.DEV_LOGIN = 'true'
process.env.ALLOWED_EMAIL_DOMAIN = 'vit.edu.in'
process.env.OSRM_URL = 'http://127.0.0.1:9' // force the offline route estimate

let app: Parameters<typeof request>[0]
const H = { 'x-ridesync': '1' }

async function login(email: string) {
  const agent = request.agent(app)
  const res = await agent.post('/api/auth/dev').set(H).send({ email })
  return { agent, res }
}

const campus = { id: 'vit-campus', name: 'VIT Wadala', area: 'Wadala', lat: 19.0222, lng: 72.8711, kind: 'campus' }
const malad = { id: 'malad', name: 'Malad', area: 'Malad Station', lat: 19.1868, lng: 72.8484, kind: 'station' }

beforeAll(async () => {
  const { createApp } = await import('../app')
  app = createApp()
})

describe('auth', () => {
  it('rejects emails outside the college domain', async () => {
    const { res } = await login('someone@gmail.com')
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/vit\.edu\.in/)
    const lookalike = await login('someone@notvit.edu.in')
    expect(lookalike.res.status).toBe(403)
  })

  it('blocks state-changing requests without the CSRF header', async () => {
    const res = await request(app).post('/api/auth/dev').send({ email: 'a.b@vit.edu.in' })
    expect(res.status).toBe(403)
  })

  it('signs in with an emailed one-time code', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const agent = request.agent(app)
    expect((await agent.post('/api/auth/code/request').set(H).send({ email: 'x@gmail.com' })).status).toBe(403)
    expect((await agent.post('/api/auth/code/request').set(H).send({ email: 'Neha.Patil@vit.edu.in' })).status).toBe(200)
    const code = String(log.mock.calls.flat().join(' ').match(/│\s+(\d{6})/)?.[1])
    log.mockRestore()
    expect((await agent.post('/api/auth/code/verify').set(H).send({ email: 'neha.patil@vit.edu.in', code: code === '000000' ? '111111' : '000000' })).status).toBe(400)
    const ok = await agent.post('/api/auth/code/verify').set(H).send({ email: 'neha.patil@vit.edu.in', code })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ isNew: true, user: { email: 'neha.patil@vit.edu.in', name: 'Neha Patil', onboarded: false } })
    // Codes are single-use.
    expect((await request(app).post('/api/auth/code/verify').set(H).send({ email: 'neha.patil@vit.edu.in', code })).status).toBe(400)
    expect((await agent.get('/api/me')).body.email).toBe('neha.patil@vit.edu.in')
    await agent.post('/api/auth/logout').set(H)
    expect((await agent.get('/api/me')).status).toBe(401)
  })

  it('requires a session', async () => {
    expect((await request(app).get('/api/me')).status).toBe(401)
    expect((await request(app).get('/api/trips')).status).toBe(401)
  })

  it('requires onboarding before using rides', async () => {
    const { agent } = await login('new.student@vit.edu.in')
    expect((await agent.get('/api/trips')).status).toBe(403)
    const bad = await agent.patch('/api/me').set(H).send({ phone: '123', onboarded: true })
    expect(bad.status).toBe(400)
  })
})

describe('full ride between two devices', () => {
  it('driver offers, rider books, ride completes', async () => {
    const driver = (await login('rahul.sharma@vit.edu.in')).agent
    const rider = (await login('priya.nair@vit.edu.in')).agent

    expect((await driver.patch('/api/me').set(H).send({ phone: '9876543210', studentId: 'VIT2201', gender: 'male', commute: 'driver', upiId: 'rahul@okaxis', onboarded: true })).status).toBe(200)
    expect((await rider.patch('/api/me').set(H).send({ phone: '9876500000', studentId: 'VIT2202', gender: 'female', commute: 'rider', onboarded: true })).status).toBe(200)
    // Student IDs are unique.
    expect((await rider.patch('/api/me').set(H).send({ studentId: 'VIT2201' })).status).toBe(409)

    // Driver needs a car to publish.
    const departAt = new Date(Date.now() + 2 * 3600_000).toISOString()
    const offer = { origin: campus, destination: malad, departAt, seats: 3, farePerSeat: 60, maxDetourKm: 3, preferences: ['no_smoking'] }
    expect((await driver.post('/api/rides').set(H).send(offer)).status).toBe(400)
    expect((await driver.put('/api/me/vehicle').set(H).send({ make: 'Honda', model: 'City', color: 'White', plate: 'MH01AB1234', seats: 3, fuel: 'petrol' })).status).toBe(200)
    // Cost-sharing cap.
    expect((await driver.post('/api/rides').set(H).send({ ...offer, farePerSeat: 2000 })).status).toBe(400)
    const pub = await driver.post('/api/rides').set(H).send(offer)
    expect(pub.status).toBe(200)
    const rideId = pub.body.id

    // Rider on another device sees it.
    const d = new Date(departAt)
    const query = { pickup: campus, drop: malad, date: departAt.slice(0, 10), time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, at: departAt, seats: 1, preferences: [] }
    const search = await rider.post('/api/rides/search').set(H).send(query)
    expect(search.status).toBe(200)
    expect(search.body.results).toHaveLength(1)
    expect(search.body.results[0].score).toBeGreaterThan(80)
    expect(search.body.results[0].driver.gender).toBeUndefined()
    const feed = await rider.get('/api/rides/feed')
    expect(feed.body.map((x: { ride: { id: string } }) => x.ride.id)).toContain(rideId)
    // Driver doesn't see their own ride.
    expect((await driver.post('/api/rides/search').set(H).send(query)).body.results).toHaveLength(0)

    const book = await rider.post('/api/bookings').set(H).send({ rideId, query, message: 'At main gate' })
    expect(book.status).toBe(200)
    const bookingId = book.body.id
    expect(book.body.status).toBe('pending')

    // Phone + UPI hidden until accepted.
    let detail = await rider.get(`/api/bookings/${bookingId}`)
    expect(detail.body.driverPhone).toBeUndefined()

    // A third student can't see the booking.
    const stranger = (await login('someone.else@vit.edu.in')).agent
    expect((await stranger.get(`/api/bookings/${bookingId}`)).status).toBe(403) // not onboarded
    await stranger.patch('/api/me').set(H).send({ phone: '9876511111', studentId: 'VIT2203', onboarded: true })
    expect((await stranger.get(`/api/bookings/${bookingId}`)).status).toBe(404)
    expect((await rider.post(`/api/bookings/${bookingId}/respond`).set(H).send({ accept: true })).status).toBe(403)

    const notes = await driver.get('/api/notifications')
    expect(notes.body[0].kind).toBe('request')

    expect((await driver.post(`/api/bookings/${bookingId}/respond`).set(H).send({ accept: true })).status).toBe(200)
    detail = await rider.get(`/api/bookings/${bookingId}`)
    expect(detail.body.booking.status).toBe('accepted')
    expect(detail.body.driverUpiId).toBe('rahul@okaxis')
    expect(detail.body.driverPhone).toBe('9876543210')

    expect((await rider.post(`/api/bookings/${bookingId}/pay`).set(H).send({ method: 'upi', reference: '412345678901' })).status).toBe(200)
    detail = await rider.get(`/api/bookings/${bookingId}`)
    expect(detail.body.booking.status).toBe('confirmed')
    expect(detail.body.booking.paymentStatus).toBe('marked_paid')

    // Chat both ways.
    expect((await rider.post(`/api/bookings/${bookingId}/messages`).set(H).send({ text: 'Hi!' })).status).toBe(200)
    expect((await driver.post(`/api/bookings/${bookingId}/messages`).set(H).send({ text: 'See you at 5' })).status).toBe(200)
    const msgs = await rider.get(`/api/bookings/${bookingId}/messages`)
    expect(msgs.body.filter((m: { system: boolean }) => !m.system).map((m: { text: string }) => m.text)).toEqual(['Hi!', 'See you at 5'])

    // Live ride.
    expect((await driver.post(`/api/rides/${rideId}/start`).set(H).send({})).status).toBe(200)
    expect((await driver.post(`/api/rides/${rideId}/location`).set(H).send({ lat: 19.03, lng: 72.87, heading: 10 })).status).toBe(200)
    const live = await rider.get(`/api/bookings/${bookingId}`)
    expect(live.body.booking.status).toBe('driver_arriving')
    expect(live.body.ride.driverLocation.lat).toBe(19.03)
    expect((await driver.post(`/api/bookings/${bookingId}/arrived`).set(H).send({})).status).toBe(200)
    // Ride start PIN: only the rider sees it; the driver must type it to pick them up.
    const pin = live.body.ridePin as string
    expect(pin).toMatch(/^\d{4}$/)
    expect((await driver.get(`/api/bookings/${bookingId}`)).body.ridePin).toBeUndefined()
    const wrong = await driver.post(`/api/bookings/${bookingId}/picked-up`).set(H).send({ pin: pin === '0000' ? '1111' : '0000' })
    expect(wrong.status).toBe(400)
    expect(wrong.body.error).toMatch(/Wrong PIN.*4 tries left/)
    expect((await driver.post(`/api/bookings/${bookingId}/picked-up`).set(H).send({})).status).toBe(400)
    expect((await driver.post(`/api/bookings/${bookingId}/picked-up`).set(H).send({ pin })).status).toBe(200)
    expect((await rider.get(`/api/bookings/${bookingId}`)).body.ridePin).toBeUndefined()

    // Share live trip: public link, no sign-in, shows the car and live location.
    const share = await rider.post(`/api/bookings/${bookingId}/share`).set(H).set('Origin', 'https://abc.trycloudflare.com').send({})
    expect(share.body.url).toMatch(/^https:\/\/abc\.trycloudflare\.com\/t\/[\w-]{16}$/)
    expect(share.body.text).toContain('White City')
    const token = share.body.url.split('/t/')[1]
    const shared = await request(app).get(`/api/share/${token}`)
    expect(shared.status).toBe(200)
    expect(shared.body).toMatchObject({ rider: 'Priya', status: 'in_progress', driverLocation: { lat: 19.03 } })
    expect(JSON.stringify(shared.body)).not.toMatch(/9876543210|@vit\.edu\.in/)
    expect((await request(app).get('/api/share/nope')).status).toBe(404)
    expect((await driver.post(`/api/bookings/${bookingId}/payment-received`).set(H).send({})).status).toBe(200)
    expect((await driver.post(`/api/bookings/${bookingId}/dropped`).set(H).send({})).status).toBe(200)
    expect((await driver.post(`/api/rides/${rideId}/complete`).set(H).send({})).status).toBe(200)

    expect((await rider.post(`/api/bookings/${bookingId}/rate`).set(H).send({ stars: 5 })).status).toBe(200)
    expect((await rider.post(`/api/bookings/${bookingId}/rate`).set(H).send({ stars: 4 })).status).toBe(409)
    expect((await driver.post(`/api/bookings/${bookingId}/rate`).set(H).send({ stars: 5 })).status).toBe(200)

    const meDriver = await driver.get('/api/me')
    expect(meDriver.body.ridesOffered).toBe(1)
    expect(meDriver.body.rating).toBe(5)
    const pays = await rider.get('/api/payments')
    expect(pays.body[0]).toMatchObject({ direction: 'paid', amount: 60, method: 'upi', status: 'received' })
    const trips = await driver.get('/api/trips')
    expect(trips.body.rides[0]).toMatchObject({ status: 'completed', earned: 60 })
  })

  it('prevents overbooking and handles declines and cancellations', async () => {
    const driver = (await login('karan.mehta@vit.edu.in')).agent
    await driver.patch('/api/me').set(H).send({ phone: '9876522222', studentId: 'VIT2210', onboarded: true })
    await driver.put('/api/me/vehicle').set(H).send({ make: 'Maruti', model: 'Swift', color: 'Red', plate: 'MH02CD5678', seats: 1, fuel: 'petrol' })
    const departAt = new Date(Date.now() + 5 * 3600_000).toISOString()
    const rideId = (await driver.post('/api/rides').set(H).send({ origin: campus, destination: malad, departAt, seats: 1, farePerSeat: 50, maxDetourKm: 3, preferences: [] })).body.id
    const query = { pickup: campus, drop: malad, date: departAt.slice(0, 10), time: '00:00', at: departAt, seats: 1, preferences: [] }

    const a = (await login('rider.one@vit.edu.in')).agent
    const b = (await login('rider.two@vit.edu.in')).agent
    await a.patch('/api/me').set(H).send({ phone: '9876533333', studentId: 'VIT2211', onboarded: true })
    await b.patch('/api/me').set(H).send({ phone: '9876544444', studentId: 'VIT2212', onboarded: true })
    const ba = (await a.post('/api/bookings').set(H).send({ rideId, query })).body.id
    const bb = (await b.post('/api/bookings').set(H).send({ rideId, query })).body.id
    expect((await driver.post(`/api/bookings/${ba}/respond`).set(H).send({ accept: true })).status).toBe(200)
    // The car is now full: the other request closes at once so that rider can pick another ride.
    expect((await b.get(`/api/bookings/${bb}`)).body.booking.status).toBe('rejected')
    expect((await b.get('/api/notifications')).body[0]).toMatchObject({ kind: 'rejected', title: expect.stringContaining('car is full') })
    expect((await driver.post(`/api/bookings/${bb}/respond`).set(H).send({ accept: true })).status).toBe(409)
    // Full ride no longer appears in search for a 3rd rider.
    const c = (await login('rider.three@vit.edu.in')).agent
    await c.patch('/api/me').set(H).send({ phone: '9876555555', studentId: 'VIT2213', onboarded: true })
    expect((await c.post('/api/rides/search').set(H).send(query)).body.results).toHaveLength(0)
    // UPI not allowed: driver has no UPI ID.
    expect((await a.post(`/api/bookings/${ba}/pay`).set(H).send({ method: 'upi' })).status).toBe(409)
    expect((await a.post(`/api/bookings/${ba}/pay`).set(H).send({ method: 'cash' })).status).toBe(200)
    // Driver cancels the ride: rider is notified and the booking is cancelled.
    expect((await driver.post(`/api/rides/${rideId}/cancel`).set(H).send({ reason: 'Car trouble' })).status).toBe(200)
    const det = await a.get(`/api/bookings/${ba}`)
    expect(det.body.booking).toMatchObject({ status: 'cancelled', cancelledBy: 'driver' })
    expect((await a.get('/api/notifications')).body[0].kind).toBe('cancelled')
  })
})

describe('safety', () => {
  it('women-only rides are hidden from and closed to male students', async () => {
    const her = (await login('sara.khan@vit.edu.in')).agent
    await her.patch('/api/me').set(H).send({ phone: '9876533301', studentId: 'VIT3301', gender: 'female', onboarded: true })
    await her.put('/api/me/vehicle').set(H).send({ make: 'Hyundai', model: 'i20', color: 'Blue', plate: 'MH01ZZ1111', seats: 3, fuel: 'petrol' })
    const him = (await login('amit.rao@vit.edu.in')).agent
    await him.patch('/api/me').set(H).send({ phone: '9876533302', studentId: 'VIT3302', gender: 'male', onboarded: true })
    await him.put('/api/me/vehicle').set(H).send({ make: 'Tata', model: 'Nexon', color: 'Grey', plate: 'MH01ZZ2222', seats: 3, fuel: 'petrol' })
    const she2 = (await login('meera.iyer@vit.edu.in')).agent
    await she2.patch('/api/me').set(H).send({ phone: '9876533303', studentId: 'VIT3303', gender: 'female', onboarded: true })

    const departAt = new Date(Date.now() + 7 * 3600_000).toISOString()
    const body = { origin: campus, destination: malad, departAt, seats: 2, farePerSeat: 50, maxDetourKm: 3, preferences: [], womenOnly: true }
    expect((await him.post('/api/rides').set(H).send(body)).status).toBe(400)
    const ride = await her.post('/api/rides').set(H).send(body)
    expect(ride.body.womenOnly).toBe(true)
    const query = { pickup: campus, drop: malad, date: departAt.slice(0, 10), time: '00:00', at: departAt, seats: 1, preferences: [] }
    const ids = async (a: typeof him) => (await a.post('/api/rides/search').set(H).send(query)).body.results.map((m: { ride: { id: string } }) => m.ride.id)
    expect(await ids(him)).not.toContain(ride.body.id)
    expect(await ids(she2)).toContain(ride.body.id)
    expect((await him.post('/api/bookings').set(H).send({ rideId: ride.body.id, query })).status).toBe(403)
    expect((await she2.post('/api/bookings').set(H).send({ rideId: ride.body.id, query })).status).toBe(200)
  })

  it('verifies student ID cards through an admin', async () => {
    const { env } = await import('../env')
    env.adminEmails.push('admin.person@vit.edu.in')
    const admin = (await login('admin.person@vit.edu.in')).agent
    await admin.patch('/api/me').set(H).send({ phone: '9876533310', studentId: 'VIT3310', onboarded: true })
    const stu = (await login('ravi.k@vit.edu.in')).agent
    await stu.patch('/api/me').set(H).send({ phone: '9876533311', studentId: 'VIT3311', onboarded: true })
    expect((await stu.get('/api/admin/id-cards')).status).toBe(403)
    expect((await stu.put('/api/me/id-card').set(H).send({ image: 'data:text/html;base64,AAAA' })).status).toBe(400)
    const up = await stu.put('/api/me/id-card').set(H).send({ image: 'data:image/jpeg;base64,/9j/AAAA' })
    expect(up.body.idStatus).toBe('pending')
    expect((await admin.get('/api/me')).body.isAdmin).toBe(true)
    const list = await admin.get('/api/admin/id-cards')
    const item = list.body.find((x: { email: string }) => x.email === 'ravi.k@vit.edu.in')
    expect(item.image).toContain('base64')
    expect((await admin.post(`/api/admin/id-cards/${item.userId}`).set(H).send({ approve: true })).status).toBe(200)
    const me = await stu.get('/api/me')
    expect(me.body).toMatchObject({ idStatus: 'verified', verified: true })
    expect((await admin.post(`/api/admin/id-cards/${item.userId}`).set(H).send({ approve: false })).status).toBe(404)

    // Admin dashboard: totals, 14-day activity, rides and users lists — admins only.
    expect((await stu.get('/api/admin/stats')).status).toBe(403)
    const stats = (await admin.get('/api/admin/stats')).body
    expect(stats.users.verified).toBeGreaterThanOrEqual(1)
    expect(stats.rides.completed).toBeGreaterThanOrEqual(1)
    expect(stats.bookings.completed).toBeGreaterThanOrEqual(1)
    expect(stats.daily).toHaveLength(14)
    expect(stats.daily.at(-1).booked).toBeGreaterThanOrEqual(1)
    const rides = (await admin.get('/api/admin/rides?status=completed')).body
    expect(rides[0]).toMatchObject({ status: 'completed', driver: expect.any(String) })
    expect(rides[0].riders.length).toBeGreaterThanOrEqual(1)
    const users = (await admin.get('/api/admin/users?q=ravi')).body
    expect(users).toHaveLength(1)
    expect(users[0]).toMatchObject({ email: 'ravi.k@vit.edu.in', idStatus: 'verified' })
  })

  it('lets an admin with a non-college email use the dashboard only', async () => {
    const { env } = await import('../env')
    env.adminEmails.push('owner.person@gmail.com')
    expect((await login('random.person@gmail.com')).res.status).toBe(403)
    const { agent: owner, res } = await login('Owner.Person@gmail.com')
    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({ isAdmin: true, adminOnly: true })
    expect((await owner.get('/api/admin/stats')).status).toBe(200)
    expect((await owner.get('/api/rides/feed')).status).toBe(403)
    // Not counted or listed as a student.
    expect((await owner.get('/api/admin/users?q=owner')).body).toHaveLength(0)
  })

  it('shares the rider’s live location with their driver until pickup', async () => {
    const d = (await login('live.driver@vit.edu.in')).agent
    await d.patch('/api/me').set(H).send({ phone: '9876533330', studentId: 'VIT3330', onboarded: true })
    await d.put('/api/me/vehicle').set(H).send({ make: 'Kia', model: 'Sonet', color: 'Red', plate: 'MH01ZZ4444', seats: 3, fuel: 'petrol' })
    const r = (await login('live.rider@vit.edu.in')).agent
    await r.patch('/api/me').set(H).send({ phone: '9876533331', studentId: 'VIT3331', onboarded: true })
    const departAt = new Date(Date.now() + 11 * 3600_000).toISOString()
    const rideId = (await d.post('/api/rides').set(H).send({ origin: campus, destination: malad, departAt, seats: 2, farePerSeat: 50, maxDetourKm: 3, preferences: [] })).body.id
    const query = { pickup: campus, drop: malad, date: departAt.slice(0, 10), time: '00:00', at: departAt, seats: 1, preferences: [] }
    const id = (await r.post('/api/bookings').set(H).send({ rideId, query })).body.id
    const here = { lat: 19.0231, lng: 72.8702, accuracy: 12 }
    // Not before the seat is confirmed.
    expect((await r.post(`/api/bookings/${id}/rider-location`).set(H).send(here)).status).toBe(409)
    await d.post(`/api/bookings/${id}/respond`).set(H).send({ accept: true })
    await r.post(`/api/bookings/${id}/pay`).set(H).send({ method: 'cash' })
    expect((await r.post(`/api/bookings/${id}/rider-location`).set(H).send(here)).status).toBe(200)
    // Only the rider can send it; only the driver sees it.
    expect((await d.post(`/api/bookings/${id}/rider-location`).set(H).send(here)).status).toBe(403)
    const seen = (await d.get(`/api/rides/${rideId}`)).body.bookings.find((x: { id: string }) => x.id === id)
    expect(seen.riderLocation).toMatchObject({ lat: 19.0231, lng: 72.8702, accuracy: 12 })
    expect((await r.get(`/api/rides/${rideId}`)).body.bookings).toBeUndefined()
    // Picked up → no longer kept.
    await d.post(`/api/rides/${rideId}/start`).set(H).send({})
    const pin = (await r.get(`/api/bookings/${id}`)).body.ridePin
    await d.post(`/api/bookings/${id}/arrived`).set(H).send({})
    expect((await d.post(`/api/bookings/${id}/picked-up`).set(H).send({ pin })).status).toBe(200)
    const after = (await d.get(`/api/rides/${rideId}`)).body.bookings.find((x: { id: string }) => x.id === id)
    expect(after.riderLocation).toBeUndefined()
    expect((await r.post(`/api/bookings/${id}/rider-location`).set(H).send(here)).status).toBe(409)
  })

  it('alerts: driver 2 min away, 15-min reminder, wait timer / no-show, car off route', async () => {
    const { run } = await import('../db')
    const { sendRideReminders } = await import('../routes')
    const d = (await login('alert.driver@vit.edu.in')).agent
    await d.patch('/api/me').set(H).send({ phone: '9876533340', studentId: 'VIT3340', onboarded: true })
    await d.put('/api/me/vehicle').set(H).send({ make: 'Tata', model: 'Punch', color: 'Blue', plate: 'MH01ZZ5555', seats: 3, fuel: 'petrol' })
    const mk = async (email: string, phone: string, sid: string) => {
      const a = (await login(email)).agent
      await a.patch('/api/me').set(H).send({ phone, studentId: sid, onboarded: true })
      return a
    }
    const r1 = await mk('alert.r1@vit.edu.in', '9876533341', 'VIT3341')
    const r2 = await mk('alert.r2@vit.edu.in', '9876533342', 'VIT3342')
    const departAt = new Date(Date.now() + 13 * 3600_000).toISOString()
    const rideId = (await d.post('/api/rides').set(H).send({ origin: campus, destination: malad, departAt, seats: 3, farePerSeat: 50, maxDetourKm: 3, preferences: [] })).body.id
    const query = { pickup: campus, drop: malad, date: departAt.slice(0, 10), time: '00:00', at: departAt, seats: 1, preferences: [] }
    const ids: string[] = []
    for (const r of [r1, r2]) {
      const id = (await r.post('/api/bookings').set(H).send({ rideId, query })).body.id
      await d.post(`/api/bookings/${id}/respond`).set(H).send({ accept: true })
      await r.post(`/api/bookings/${id}/pay`).set(H).send({ method: 'cash' })
      ids.push(id)
    }
    const latest = async (a: typeof d) => (await a.get('/api/notifications')).body[0].title as string

    // 15 minutes before: riders and driver are reminded (once).
    sendRideReminders(new Date(departAt).getTime() - 15 * 60_000)
    expect(await latest(r1)).toBe('Your ride leaves in 15 min')
    expect(await latest(d)).toBe('Your ride starts in 15 min')
    sendRideReminders(new Date(departAt).getTime() - 14 * 60_000)
    expect((await r1.get('/api/notifications')).body.filter((n: { title: string }) => n.title === 'Your ride leaves in 15 min')).toHaveLength(1)

    // Driver drives: far away → nothing; within 800 m → "about 2 min away" (once).
    await d.post(`/api/rides/${rideId}/start`).set(H).send({})
    await d.post(`/api/rides/${rideId}/location`).set(H).send({ lat: 19.06, lng: 72.88 })
    expect(await latest(r1)).not.toMatch(/2 min away/)
    await d.post(`/api/rides/${rideId}/location`).set(H).send({ lat: 19.0262, lng: 72.8711 })
    expect(await latest(r1)).toMatch(/about 2 min away/)

    // Rider 2 never comes: no-show only after waiting 5 minutes.
    await d.post(`/api/bookings/${ids[1]}/arrived`).set(H).send({})
    expect((await d.post(`/api/bookings/${ids[1]}/no-show`).set(H).send({})).status).toBe(409)
    run(`UPDATE bookings SET arrived_at = ? WHERE id = ?`, new Date(Date.now() - 6 * 60_000).toISOString(), ids[1])
    expect((await r2.post(`/api/bookings/${ids[1]}/no-show`).set(H).send({})).status).toBe(403)
    expect((await d.post(`/api/bookings/${ids[1]}/no-show`).set(H).send({})).status).toBe(200)
    expect((await r2.get(`/api/bookings/${ids[1]}`)).body.booking).toMatchObject({ status: 'cancelled', cancelledBy: 'rider' })

    // Rider 1 picked up; the car goes far off route 3 times → "left the usual route".
    await d.post(`/api/bookings/${ids[0]}/arrived`).set(H).send({})
    const pin = (await r1.get(`/api/bookings/${ids[0]}`)).body.ridePin
    await d.post(`/api/bookings/${ids[0]}/picked-up`).set(H).send({ pin })
    for (let i = 0; i < 3; i++) await d.post(`/api/rides/${rideId}/location`).set(H).send({ lat: 19.0, lng: 73.05 + i * 0.01 })
    expect(await latest(r1)).toBe('Your car has left the usual route')
  })

  it('locks the PIN after 5 wrong tries and alerts the rider', async () => {
    const d = (await login('pin.driver@vit.edu.in')).agent
    await d.patch('/api/me').set(H).send({ phone: '9876533320', studentId: 'VIT3320', onboarded: true })
    await d.put('/api/me/vehicle').set(H).send({ make: 'Kia', model: 'Seltos', color: 'Black', plate: 'MH01ZZ3333', seats: 3, fuel: 'petrol' })
    const r = (await login('pin.rider@vit.edu.in')).agent
    await r.patch('/api/me').set(H).send({ phone: '9876533321', studentId: 'VIT3321', onboarded: true })
    const departAt = new Date(Date.now() + 9 * 3600_000).toISOString()
    const rideId = (await d.post('/api/rides').set(H).send({ origin: campus, destination: malad, departAt, seats: 2, farePerSeat: 50, maxDetourKm: 3, preferences: [] })).body.id
    const query = { pickup: campus, drop: malad, date: departAt.slice(0, 10), time: '00:00', at: departAt, seats: 1, preferences: [] }
    const id = (await r.post('/api/bookings').set(H).send({ rideId, query })).body.id
    await d.post(`/api/bookings/${id}/respond`).set(H).send({ accept: true })
    await r.post(`/api/bookings/${id}/pay`).set(H).send({ method: 'cash' })
    const pin = (await r.get(`/api/bookings/${id}`)).body.ridePin
    await d.post(`/api/rides/${rideId}/start`).set(H).send({})
    const bad = pin === '9999' ? '8888' : '9999'
    for (let i = 0; i < 4; i++) expect((await d.post(`/api/bookings/${id}/picked-up`).set(H).send({ pin: bad })).status).toBe(400)
    expect((await d.post(`/api/bookings/${id}/picked-up`).set(H).send({ pin: bad })).status).toBe(429)
    expect((await d.post(`/api/bookings/${id}/picked-up`).set(H).send({ pin })).status).toBe(429)
    expect((await r.get('/api/notifications')).body[0].title).toMatch(/Wrong ride PIN/)
  })
})
