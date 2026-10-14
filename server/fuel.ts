import { db, one, run } from './db'

/**
 * The real petrol price, read automatically from public fuel-price pages (Mumbai), so the suggested
 * price per seat follows the real world:
 *
 *   ₹ per km per seat = petrol ₹ a litre ÷ 15 km a litre ÷ 4 people (driver + 3 riders)
 *
 * The server reads it at start-up and every 6 hours; the last good reading is kept in `settings`
 * (key `fuel_price`). If no page can be read, the last reading (or the built-in one) is used.
 */

/** Mumbai petrol on 11 October 2026; used until the first reading. */
export const DEFAULT_PETROL = 111.21
/** A typical small petrol car in city traffic. */
export const KM_PER_LITRE = 15
/** Driver + 3 riders. */
export const PEOPLE = 4
/** Readings outside this range are treated as a page-reading mistake. */
export const PETROL_RANGE = { min: 60, max: 200 }

/** Public pages that show today's petrol price in Mumbai. FUEL_PRICE_URLS (comma-separated) replaces them. */
export const FUEL_SOURCES = [
  'https://www.bankbazaar.com/fuel/petrol-price-mumbai.html',
  'https://www.goodreturns.in/petrol-price-in-mumbai.html',
  'https://energy.thecore.in/fuel/petrol-price/mumbai',
  'https://www.aajtak.in/fuel-price/petrol-price-in-mumbai-today',
]

export type FuelPrice = { petrol: number; source: string; at: string | null }

db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)

export function fuelPrice(): FuelPrice {
  const row = one<{ value: string }>(`SELECT value FROM settings WHERE key = 'fuel_price'`)
  try {
    if (row) return JSON.parse(row.value) as FuelPrice
  } catch {
    /* fall through to the built-in price */
  }
  return { petrol: DEFAULT_PETROL, source: 'built-in, Mumbai 11 Oct 2026', at: null }
}

export function saveFuelPrice(p: FuelPrice) {
  run(`INSERT INTO settings (key, value) VALUES ('fuel_price', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, JSON.stringify(p))
}

/** ₹ per km per seat from a petrol price, to the nearest 5 paise: ₹111.21 → ₹1.85. */
export const perSeatKmFromPetrol = (petrol: number) => Math.round((petrol / KM_PER_LITRE / PEOPLE) * 20) / 20

const plausible = (n: number) => n >= PETROL_RANGE.min && n <= PETROL_RANGE.max

/** Today's petrol price from a fuel-price web page: the first "₹ 111.21" / "Rs. 111.21" after the word petrol. */
export function parsePetrolPrice(html: string): number | null {
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&#8377;|&#x20b9;|&#x20B9;/g, '₹')
    .replace(/\s+/g, ' ')
  const price = /(?:₹|rs\.?|inr)\s*(\d{2,3}(?:\.\d{1,2})?)/gi
  // Prefer a price shortly after "petrol" (pages also show diesel, LPG and changes like "₹0.12").
  for (const m of text.matchAll(/petrol/gi)) {
    const near = text.slice(m.index, m.index + 200)
    for (const p of near.matchAll(price)) {
      const n = Number(p[1])
      if (plausible(n)) return n
    }
  }
  return null
}

function sources() {
  const own = (process.env.FUEL_PRICE_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return own.length ? own : FUEL_SOURCES
}

/** Reads today's price from the first page that answers; keeps the last reading if none does. */
export async function refreshFuelPrice(get: typeof fetch = fetch): Promise<{ ok: boolean; price: FuelPrice; tried: string[] }> {
  const tried: string[] = []
  for (const url of sources()) {
    tried.push(url)
    try {
      const res = await get(url, { headers: { 'user-agent': 'Mozilla/5.0 (RideSync fare rate)' }, signal: AbortSignal.timeout(10_000) })
      if (!res.ok) continue
      const petrol = parsePetrolPrice(await res.text())
      if (petrol == null) continue
      const price = { petrol, source: new URL(url).hostname, at: new Date().toISOString() }
      saveFuelPrice(price)
      return { ok: true, price, tried }
    } catch {
      /* try the next page */
    }
  }
  return { ok: false, price: fuelPrice(), tried }
}
