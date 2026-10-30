import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'

process.env.DATABASE_PATH = ':memory:'
process.env.DEV_LOGIN = 'true'
process.env.ALLOWED_EMAIL_DOMAIN = 'vit.edu.in'
process.env.ADMIN_EMAILS = 'fuel.admin@vit.edu.in'
process.env.FUEL_PRICE_URLS = 'https://down.example/petrol, https://fuel.example/mumbai'

type Fuel = typeof import('../fuel')
type Fare = typeof import('../fare')
let fuel: Fuel
let fare: Fare
let app: Parameters<typeof request>[0]
const H = { 'x-ridesync': '1' }

beforeAll(async () => {
  fuel = await import('../fuel')
  fare = await import('../fare')
  app = (await import('../app')).createApp()
})

/** A fuel-price page as these sites print it: diesel and a day's change next to petrol. */
const page = (petrol: string) => `<html><head><script>var p = "₹ 999.99"</script></head><body>
  <h1>Petrol Price in Mumbai Today</h1><p>Change: <span>&#8377; 0.12</span></p>
  <table><tr><td>Petrol</td><td>&#8377;&nbsp;${petrol}/L</td></tr><tr><td>Diesel</td><td>Rs. 97.83</td></tr></table></body></html>`

const fakeFetch = (petrol: string): typeof fetch =>
  (async (url: string | URL | Request) =>
    String(url).includes('down.example') ? new Response('busy', { status: 503 }) : new Response(page(petrol))) as typeof fetch

describe('real petrol price', () => {
  it('reads the petrol price from a fuel-price page', () => {
    expect(fuel.parsePetrolPrice(page('111.21'))).toBe(111.21)
    expect(fuel.parsePetrolPrice('Petrol in Mumbai: Rs 104.21 per litre')).toBe(104.21)
    expect(fuel.parsePetrolPrice('<p>Diesel ₹ 97.83</p>')).toBeNull() // no petrol price on the page
    expect(fuel.parsePetrolPrice('Petrol ₹ 1,050')).toBeNull() // not a believable price
  })

  it('reads the diesel price too', () => {
    expect(fuel.parseFuelPrice(page('111.21'), 'diesel')).toBe(97.83)
    expect(fuel.parseFuelPrice('<p>Petrol ₹ 111.21</p>', 'diesel')).toBeNull()
  })

  it('turns it into ₹ per km per seat (FARE_MODE=seat): petrol ÷ a hatchback\'s 11.8 km/L at Mumbai speed ÷ 4 people', () => {
    expect(fuel.KM_PER_LITRE).toBe(11.8)
    expect(fuel.perSeatKmFromPetrol(111.21)).toBe(2.35)
    expect(fuel.perSeatKmFromPetrol(96)).toBe(2.05)
    expect(fuel.perSeatKmFromPetrol(130)).toBe(2.75)
  })

  it('gives each fuel and car size its own cost and CO₂ per km at a typical Mumbai speed', () => {
    expect(fuel.fuelCost('petrol')).toMatchObject({ price: 111.21, kmPerUnit: 11.8, perSeatKm: 2.35, co2KgPerKm: 0.196 })
    expect(fuel.fuelCost('diesel')).toMatchObject({ price: 97.83, kmPerUnit: 14.7, perSeatKm: 1.65, co2KgPerKm: 0.182 })
    expect(fuel.fuelCost('cng')).toMatchObject({ unit: 'kg', price: 77, kmPerUnit: 15.9, perSeatKm: 1.2, co2KgPerKm: 0.173 })
    expect(fuel.fuelCost('ev')).toMatchObject({ unit: 'kWh', price: 12, kmPerUnit: 8.2, perSeatKm: 0.35, co2KgPerKm: 0.088 })
    expect(fuel.fuelCost('petrol', 'sedan')).toMatchObject({ kmPerUnit: 9.4, jamPerHour: 1.25 })
  })

  it('follows the real price automatically; the admin can set their own and switch back', async () => {
    // Before any reading: the built-in Mumbai price.
    expect(fare.fareRates().perSeatKm).toBe(2.35)
    // The first page is down, the second answers: the price is saved and new rides follow it.
    const r = await fuel.refreshFuelPrice(fakeFetch('120.00'))
    expect(r).toMatchObject({ ok: true, price: { petrol: 120, diesel: 97.83, source: 'fuel.example' } })
    expect(r.tried).toHaveLength(2)
    expect(fare.fareRates().perSeatKm).toBe(2.55)
    expect(fare.seatPrice(25).suggested).toBe(65)
    // Nothing answers: the last reading stays.
    const failing = (async () => new Response('', { status: 500 })) as typeof fetch
    expect(await fuel.refreshFuelPrice(failing)).toMatchObject({ ok: false, price: { petrol: 120 } })

    const admin = request.agent(app)
    await admin.post('/api/auth/dev').set(H).send({ email: 'fuel.admin@vit.edu.in' })
    const report = (await admin.get('/api/admin/fare-rates')).body
    expect(report).toMatchObject({ auto: true, rates: { perSeatKm: 2.55 }, fuel: { petrol: 120, kmPerLitre: 11.8, people: 4, perSeatKm: 2.55 } })
    expect(report.fuels.map((f: { fuel: string; auto: boolean }) => [f.fuel, f.auto])).toEqual([
      ['petrol', true],
      ['diesel', true],
      ['cng', false],
      ['ev', false],
    ])

    // CNG and electricity prices are the admin's to set; out-of-range prices are refused.
    expect((await admin.put('/api/admin/fare-rates').set(H).send({ prices: { cng: 5 } })).status).toBe(400)
    const set = (await admin.put('/api/admin/fare-rates').set(H).send({ prices: { cng: 80, ev: 10 } })).body
    expect(set.fuels.find((f: { fuel: string }) => f.fuel === 'cng')).toMatchObject({ price: 80, perSeatKm: 1.25 })
    expect(set.fuels.find((f: { fuel: string }) => f.fuel === 'ev')).toMatchObject({ price: 10, perSeatKm: 0.3 })
    expect(set.fuel.petrol).toBe(120)

    // The admin's own rate wins, even when petrol changes...
    expect((await admin.put('/api/admin/fare-rates').set(H).send({ perSeatKm: 2.5 })).body).toMatchObject({ auto: false, rates: { perSeatKm: 2.5 } })
    await fuel.refreshFuelPrice(fakeFetch('96.00'))
    expect(fare.fareRates().perSeatKm).toBe(2.5)
    // ...until they switch back to automatic.
    expect((await admin.put('/api/admin/fare-rates').set(H).send({ auto: true })).body).toMatchObject({ auto: true, rates: { perSeatKm: 2.05 } })
  })
})
