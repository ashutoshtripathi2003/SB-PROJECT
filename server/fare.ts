import { db, one, run } from './db'

/**
 * Fares, exactly the BlaBlaCar way: a fixed price per seat that the driver sets.
 *
 *   suggested price = route km × ₹ per km per seat (₹2 by default, set by the admin)
 *   driver may set  = half to one and a half times the suggestion, never below ₹30
 *   a rider pays    = the seat price for the part of the route they ride (matching: at least 40% of it)
 *
 * The price is fixed when the ride is published and never changes for anyone who books. No platform fee.
 *
 * FARE_MODE=share keeps an earlier design (the trip's cost from km and minutes, split live among everyone
 * with a 10% cushion that drops as riders join and at the start); rides created that way keep working.
 */

/** perSeatKm: ₹ per km per seat (the BlaBlaCar-style suggestion). perKm / perMin: the earlier trip-cost design. */
export type FareRates = { perSeatKm: number; perKm: number; perMin: number }

export const DEFAULT_RATES: FareRates = { perSeatKm: 2, perKm: 7, perMin: 1 }
/** What the admin may set them to. */
export const RATE_LIMITS = { perSeatKm: { min: 0.5, max: 10 }, perKm: { min: 1, max: 50 }, perMin: { min: 0, max: 10 } }

/** Cushion in the booked price, so a worse jam on the day than forecast doesn't cost the driver. */
export const CUSHION = 1.1
export const MIN_FARE = 30

db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)

export function fareRates(): FareRates {
  const row = one<{ value: string }>(`SELECT value FROM settings WHERE key = 'fare_rates'`)
  try {
    return { ...DEFAULT_RATES, ...(row ? (JSON.parse(row.value) as Partial<FareRates>) : {}) }
  } catch {
    return { ...DEFAULT_RATES }
  }
}

export function setFareRates(p: Partial<FareRates>) {
  run(`INSERT INTO settings (key, value) VALUES ('fare_rates', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, JSON.stringify({ ...fareRates(), ...p }))
}

export type RouteLike = { distanceKm: number; durationMin: number; trafficDelayMin?: number }

export type TripCost = {
  total: number
  km: number
  min: number
  /** Minutes of the trip spent in traffic (part of `min`). */
  trafficMin: number
  perKm: number
  perMin: number
  distanceCost: number
  timeCost: number
  /** One line people can check: "18 km × ₹7 + 55 min × ₹1 = ₹181" */
  summary: string
}

const r1 = (n: number) => Math.round(n * 10) / 10

export function tripCost(route: RouteLike, rates: Pick<FareRates, 'perKm' | 'perMin'> = fareRates()): TripCost {
  const km = r1(Math.max(0, route.distanceKm))
  const min = Math.max(0, Math.round(route.durationMin))
  const distanceCost = km * rates.perKm
  const timeCost = min * rates.perMin
  const total = Math.round(distanceCost + timeCost)
  return {
    total,
    km,
    min,
    trafficMin: Math.max(0, Math.min(min, Math.round(route.trafficDelayMin ?? 0))),
    perKm: rates.perKm,
    perMin: rates.perMin,
    distanceCost: Math.round(distanceCost),
    timeCost: Math.round(timeCost),
    summary: `${km} km × ₹${rates.perKm} + ${min} min × ₹${rates.perMin} = ₹${total}`,
  }
}

export type Rider = { id: string; km: number; seats: number; max?: number }

const round5 = (n: number) => Math.round(n / 5) * 5

/** Each rider's equal share (total for their seats), by person-km; the driver's own share stays with them. */
export function splitCost(cost: number, driverKm: number, riders: Rider[]): Map<string, number> {
  const total = Math.max(driverKm, 0.1) + riders.reduce((s, r) => s + r.km * r.seats, 0)
  const out = new Map<string, number>()
  for (const r of riders) {
    const share = (cost * r.km * r.seats) / total
    let fare = Math.max(MIN_FARE * r.seats, round5(share))
    if (r.max != null) fare = Math.min(fare, r.max)
    out.set(r.id, fare)
  }
  return out
}

/** What each person pays when the car is full (for ride cards: "from ₹105"). */
export const perPersonIfFull = (cost: number, seats: number) => Math.max(MIN_FARE, round5(cost / (seats + 1)))

export type FareMode = 'seat' | 'share'
/** How new rides are priced: 'seat' (BlaBlaCar-style, the default) or 'share' (the earlier live split). */
export const fareMode = (): FareMode => (process.env.FARE_MODE === 'share' ? 'share' : 'seat')

const floor5 = (n: number) => Math.floor(n / 5) * 5

/**
 * The price per seat for the whole route, as BlaBlaCar does it: a suggestion from the distance, and the
 * range the driver may choose from (half to one and a half times the suggestion, never below ₹30).
 */
export function seatPrice(km: number, perSeatKm = fareRates().perSeatKm) {
  const suggested = Math.max(MIN_FARE, round5(Math.max(0, km) * perSeatKm))
  const min = Math.max(MIN_FARE, floor5(suggested * 0.5))
  const max = Math.max(suggested, round5(suggested * 1.5))
  return { suggested, min, max, perSeatKm }
}

/** The driver's own share: the trip cost minus what the riders pay (the driver pays it themselves). */
export const driverShare = (cost: number, ridersPay: number) => Math.max(0, Math.round(cost - ridersPay))

/** Driver's preview: what each rider pays with 1, 2, … riders going the whole way. */
export function shareTable(cost: number, seats: number) {
  return Array.from({ length: seats }, (_, i) => ({ riders: i + 1, each: Math.max(MIN_FARE, round5(cost / (i + 2))) }))
}
