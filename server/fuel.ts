import { FUEL_SPECS } from '../src/lib/fuel'
import { db, one, run } from './db'

/**
 * Fuel: what each kind of car costs to run and how much CO₂ it gives off, with real Mumbai prices.
 *
 *   ₹ per km per seat = fuel price ÷ the car's km per litre (kg, kWh) in city traffic ÷ 4 people (driver + 3 riders)
 *
 * Petrol and diesel prices are read automatically from public fuel-price pages (Mumbai) at start-up and every
 * 6 hours; CNG and electricity change rarely, so the admin sets them. The last good readings are kept in
 * `settings` (key `fuel_price`). The km per unit is the driver's own figure when they give one, else the typical
 * city-traffic figure (src/lib/fuel.ts; well under brochure mileage: Mumbai traffic is stop-and-go).
 */

export type FuelType = 'petrol' | 'diesel' | 'cng' | 'ev'

export type FuelInfo = {
  label: string
  unit: 'litre' | 'kg' | 'kWh'
  /** Built-in ₹ per unit, used until the first reading (petrol, diesel) or until the admin sets one. */
  price: number
  /** Typical km per unit in Mumbai city traffic. */
  kmPerUnit: number
  /** kg of CO₂ from one unit (for EVs, from the electricity grid that charges it). */
  co2PerUnit: number
  /** Believable km per unit a driver may enter. */
  mileage: { min: number; max: number }
  /** True when the price is read from fuel-price pages; false when the admin sets it. */
  auto: boolean
}

/** Mumbai petrol on 11 October 2026; used until the first reading. */
export const DEFAULT_PETROL = 111.21

export const FUELS: Record<FuelType, FuelInfo> = {
  petrol: { ...FUEL_SPECS.petrol, price: DEFAULT_PETROL, auto: true },
  diesel: { ...FUEL_SPECS.diesel, price: 97.83, auto: true },
  cng: { ...FUEL_SPECS.cng, price: 77, auto: false },
  ev: { ...FUEL_SPECS.ev, price: 12, auto: false },
}
export const FUEL_TYPES = Object.keys(FUELS) as FuelType[]

/** Petrol km per litre in city traffic (kept for older callers). */
export const KM_PER_LITRE = FUELS.petrol.kmPerUnit
/** Driver + 3 riders. */
export const PEOPLE = 4
/** Petrol/diesel readings outside this range are treated as a page-reading mistake. */
export const PETROL_RANGE = { min: 60, max: 200 }
/** What the admin may set each fuel's price to (₹ a litre, kg or kWh). */
export const PRICE_RANGE: Record<FuelType, { min: number; max: number }> = {
  petrol: PETROL_RANGE,
  diesel: PETROL_RANGE,
  cng: { min: 30, max: 200 },
  ev: { min: 2, max: 40 },
}

/** Public pages that show today's petrol and diesel prices in Mumbai. FUEL_PRICE_URLS (comma-separated) replaces them. */
export const FUEL_SOURCES = [
  'https://www.bankbazaar.com/fuel/petrol-price-mumbai.html',
  'https://www.goodreturns.in/petrol-price-in-mumbai.html',
  'https://energy.thecore.in/fuel/petrol-price/mumbai',
  'https://www.aajtak.in/fuel-price/petrol-price-in-mumbai-today',
  'https://www.goodreturns.in/diesel-price-in-mumbai.html',
  'https://www.bankbazaar.com/fuel/diesel-price-mumbai.html',
]

export type FuelPrice = { petrol: number; diesel: number; cng: number; ev: number; source: string; at: string | null }

db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)

const BUILT_IN: FuelPrice = { petrol: DEFAULT_PETROL, diesel: FUELS.diesel.price, cng: FUELS.cng.price, ev: FUELS.ev.price, source: 'built-in, Mumbai 11 Oct 2026', at: null }

export function fuelPrice(): FuelPrice {
  const row = one<{ value: string }>(`SELECT value FROM settings WHERE key = 'fuel_price'`)
  try {
    if (row) return { ...BUILT_IN, ...(JSON.parse(row.value) as Partial<FuelPrice>) }
  } catch {
    /* fall through to the built-in prices */
  }
  return BUILT_IN
}

export function saveFuelPrice(p: Partial<FuelPrice>) {
  run(`INSERT INTO settings (key, value) VALUES ('fuel_price', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, JSON.stringify({ ...fuelPrice(), ...p }))
}

/** The admin's CNG / electricity (or a corrected petrol / diesel) price. */
export function setFuelPrices(p: Partial<Record<FuelType, number>>) {
  saveFuelPrice(p)
}

const round05 = (n: number) => Math.round(n * 20) / 20

/** ₹ per km per seat for a fuel price and km per unit, to the nearest 5 paise. */
export const perSeatKmFor = (price: number, kmPerUnit: number) => round05(price / kmPerUnit / PEOPLE)

/** ₹ per km per seat for a petrol price in a typical car: ₹111.21 ÷ 10 km/L ÷ 4 → ₹2.80. */
export const perSeatKmFromPetrol = (petrol: number) => perSeatKmFor(petrol, KM_PER_LITRE)

/** The driver's own km per unit if it is believable for that fuel, else undefined. */
export function ownMileage(fuel: FuelType, mileage: unknown): number | undefined {
  const n = typeof mileage === 'number' ? mileage : null
  const r = FUELS[fuel].mileage
  return n != null && Number.isFinite(n) && n >= r.min && n <= r.max ? Math.round(n * 10) / 10 : undefined
}

/** What one km in this car costs and gives off: the numbers behind a fare and a CO₂ figure. */
export function fuelCost(fuel: FuelType = 'petrol', mileage?: number) {
  const info = FUELS[fuel] ?? FUELS.petrol
  const own = ownMileage(fuel, mileage)
  const kmPerUnit = own ?? info.kmPerUnit
  const price = fuelPrice()[fuel] ?? info.price
  return {
    fuel,
    label: info.label,
    unit: info.unit,
    price,
    kmPerUnit,
    ownMileage: own != null,
    people: PEOPLE,
    perSeatKm: perSeatKmFor(price, kmPerUnit),
    co2KgPerKm: Math.round((info.co2PerUnit / kmPerUnit) * 1000) / 1000,
  }
}
export type FuelCost = ReturnType<typeof fuelCost>

const plausible = (n: number) => n >= PETROL_RANGE.min && n <= PETROL_RANGE.max

/** Today's price of `fuel` from a fuel-price web page: the first "₹ 111.21" / "Rs. 111.21" after its name. */
export function parseFuelPrice(html: string, fuel: 'petrol' | 'diesel'): number | null {
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&#8377;|&#x20b9;|&#x20B9;/g, '₹')
    .replace(/\s+/g, ' ')
  const price = /(?:₹|rs\.?|inr)\s*(\d{2,3}(?:\.\d{1,2})?)/gi
  // Prefer a price shortly after the fuel's name (pages also show other fuels and changes like "₹0.12").
  for (const m of text.matchAll(new RegExp(fuel, 'gi'))) {
    const near = text.slice(m.index, m.index + 200)
    for (const p of near.matchAll(price)) {
      const n = Number(p[1])
      if (plausible(n)) return n
    }
  }
  return null
}

/** Today's petrol price from a fuel-price page. */
export const parsePetrolPrice = (html: string) => parseFuelPrice(html, 'petrol')

function sources() {
  const own = (process.env.FUEL_PRICE_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return own.length ? own : FUEL_SOURCES
}

/** Reads today's petrol and diesel prices from the first pages that answer; keeps the last readings otherwise. */
export async function refreshFuelPrice(get: typeof fetch = fetch): Promise<{ ok: boolean; price: FuelPrice; tried: string[] }> {
  const tried: string[] = []
  const found: { petrol?: number; diesel?: number; source?: string } = {}
  for (const url of sources()) {
    if (found.petrol != null && found.diesel != null) break
    tried.push(url)
    try {
      const res = await get(url, { headers: { 'user-agent': 'Mozilla/5.0 (RideSync fare rate)' }, signal: AbortSignal.timeout(10_000) })
      if (!res.ok) continue
      const html = await res.text()
      if (found.petrol == null) {
        const petrol = parseFuelPrice(html, 'petrol')
        if (petrol != null) Object.assign(found, { petrol, source: new URL(url).hostname })
      }
      found.diesel ??= parseFuelPrice(html, 'diesel') ?? undefined
    } catch {
      /* try the next page */
    }
  }
  if (found.petrol == null) {
    if (found.diesel != null) saveFuelPrice({ diesel: found.diesel })
    return { ok: false, price: fuelPrice(), tried }
  }
  saveFuelPrice({ petrol: found.petrol, ...(found.diesel != null ? { diesel: found.diesel } : {}), source: found.source, at: new Date().toISOString() })
  return { ok: true, price: fuelPrice(), tried }
}
