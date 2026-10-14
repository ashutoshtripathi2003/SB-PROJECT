import { db, one, run } from './db'

/**
 * Fair fares: the cost of the trip from its distance and its time, split equally among everyone in the car.
 *
 *   trip cost  = km × ₹ per km  +  minutes × ₹ per minute
 *   each share = trip cost × (that person's km × seats) ÷ (everyone's km × seats, the driver included)
 *
 * The km and the minutes come from the route with TomTom's traffic, so a jam (more minutes) costs a little
 * more, exactly like the extra fuel it burns. Nothing depends on the car: it works for every car, and the
 * driver types nothing. The two rates are set by the admin.
 *
 * A rider's price is locked when they book: their share with the traffic forecast plus a 10% cushion
 * for a worse jam on the day. It only goes down: as more riders join, and once more when the driver
 * starts the trip, if the live traffic makes the real cost lower. It never goes up.
 */

export type FareRates = { perKm: number; perMin: number }

/** ₹ per km (fuel, tyres and servicing) and ₹ per minute (extra fuel while crawling in traffic). */
export const DEFAULT_RATES: FareRates = { perKm: 7, perMin: 1 }
/** What the admin may set them to. */
export const RATE_LIMITS = { perKm: { min: 1, max: 50 }, perMin: { min: 0, max: 10 } }

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

export function tripCost(route: RouteLike, rates = fareRates()): TripCost {
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

/** Driver's preview: what each rider pays with 1, 2, … riders going the whole way. */
export function shareTable(cost: number, seats: number) {
  return Array.from({ length: seats }, (_, i) => ({ riders: i + 1, each: Math.max(MIN_FARE, round5(cost / (i + 2))) }))
}
