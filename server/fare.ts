import type { Vehicle } from '../src/lib/types'
import { db, one, run } from './db'

/**
 * Fair fares: the real cost of the trip, split equally among everyone in the car.
 *
 *   trip cost  = fuel needed (the driver's own car, under this trip's traffic) + wear (tyres, servicing)
 *   each share = trip cost × (that person's km × seats) ÷ (everyone's km × seats, the driver included)
 *
 * The driver never pays more than an equal share, and nobody profits. A rider sees their share now
 * (it falls as more riders join) and a guaranteed maximum; the share becomes final when the driver
 * starts the trip, priced with the live traffic at that moment and never above the maximum.
 */

export type Fuel = Vehicle['fuel']
export type Mileage = { smooth: number; city: number; traffic: number }

/** Typical mileage per condition when the driver hasn't entered their own (km per L / kg / kWh). */
export const DEFAULT_MILEAGE: Record<Fuel, Mileage> = {
  petrol: { smooth: 18, city: 14, traffic: 7 },
  diesel: { smooth: 20, city: 16, traffic: 8 },
  cng: { smooth: 26, city: 22, traffic: 11 },
  // Electric cars use more energy at highway speed and almost none standing still.
  ev: { smooth: 6, city: 7, traffic: 7 },
}

/** Tyres and servicing, ₹ per km (diesel engines cost a little more to service; electric cars less). */
export const WEAR_PER_KM: Record<Fuel, number> = { petrol: 3, diesel: 3.5, cng: 3, ev: 2.5 }

/** ₹ per litre (petrol, diesel), per kg (CNG), per unit/kWh (electric). The admin can change these. */
export const DEFAULT_FUEL_PRICES: Record<Fuel, number> = { petrol: 104, diesel: 90, cng: 77, ev: 10 }
export const FUEL_UNIT: Record<Fuel, string> = { petrol: 'L', diesel: 'L', cng: 'kg', ev: 'kWh' }

/** Head-room on the maximum, so worse traffic at the start than forecast stays within it. */
export const MAX_BUFFER = 1.15
export const MIN_FARE = 30

db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)

export function fuelPrices(): Record<Fuel, number> {
  const row = one<{ value: string }>(`SELECT value FROM settings WHERE key = 'fuel_prices'`)
  try {
    return { ...DEFAULT_FUEL_PRICES, ...(row ? (JSON.parse(row.value) as Partial<Record<Fuel, number>>) : {}) }
  } catch {
    return { ...DEFAULT_FUEL_PRICES }
  }
}

export function setFuelPrices(p: Partial<Record<Fuel, number>>) {
  run(`INSERT INTO settings (key, value) VALUES ('fuel_prices', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, JSON.stringify({ ...fuelPrices(), ...p }))
}

/**
 * The car's mileage in each condition: what the driver entered, the blanks filled from the typical
 * values for that fuel, scaled to how their car compares on the conditions they did enter.
 */
export function mileageFor(fuel: Fuel, own: Partial<Mileage> = {}): Mileage {
  const base = DEFAULT_MILEAGE[fuel]
  const keys = ['smooth', 'city', 'traffic'] as const
  const given = keys.filter((k) => (own[k] ?? 0) > 0)
  const scale = given.length ? given.reduce((s, k) => s + own[k]! / base[k], 0) / given.length : 1
  return { smooth: own.smooth || base.smooth * scale, city: own.city || base.city * scale, traffic: own.traffic || base.traffic * scale }
}

export type RouteLike = { distanceKm: number; durationMin: number; trafficDelayMin?: number }

export type TripCost = {
  total: number
  fuel: Fuel
  unit: string
  km: { smooth: number; city: number; traffic: number }
  mileage: Mileage
  fuelUsed: number
  fuelPrice: number
  fuelCost: number
  wear: number
  /** One line people can check: "18 km city @ 11.5 km/L + 7 km traffic @ 3.5 km/L = 3.6 L × ₹90 …" */
  summary: string
}

const JAM_KMH = 10
const r1 = (n: number) => Math.round(n * 10) / 10

/**
 * Splits the route into smooth, city and stuck-in-traffic km from TomTom's numbers:
 *   - the traffic delay (extra minutes) is time spent crawling at ~10 km/h, which gives the jam km;
 *   - the rest is smooth or city driving depending on the average speed with empty roads.
 */
export function conditionKm(route: RouteLike) {
  const d = Math.max(0.1, route.distanceKm)
  const delay = Math.max(0, Math.min(route.trafficDelayMin ?? 0, route.durationMin))
  const freeMin = Math.max(route.durationMin - delay, (d / 80) * 60)
  const vFree = d / (freeMin / 60)
  let traffic = 0
  if (delay > 0) traffic = vFree <= JAM_KMH * 1.2 ? d * Math.min(1, delay / Math.max(1, route.durationMin)) : delay / 60 / (1 / JAM_KMH - 1 / vFree)
  traffic = Math.min(d, Math.max(0, traffic))
  const rest = d - traffic
  const smoothShare = Math.min(1, Math.max(0, (vFree - 25) / (55 - 25)))
  return { smooth: rest * smoothShare, city: rest * (1 - smoothShare), traffic }
}

export function tripCost(fuel: Fuel, own: Partial<Mileage>, route: RouteLike, prices = fuelPrices()): TripCost {
  const mileage = mileageFor(fuel, own)
  const km = conditionKm(route)
  const fuelUsed = km.smooth / mileage.smooth + km.city / mileage.city + km.traffic / mileage.traffic
  const fuelPrice = prices[fuel]
  const fuelCost = fuelUsed * fuelPrice
  const wear = route.distanceKm * WEAR_PER_KM[fuel]
  const total = Math.round(fuelCost + wear)
  const unit = FUEL_UNIT[fuel]
  const per = `km/${unit}`
  const parts = (
    [
      ['smooth', 'smooth roads'],
      ['city', 'city'],
      ['traffic', 'heavy traffic'],
    ] as const
  )
    .filter(([k]) => km[k] >= 0.5)
    .map(([k, label]) => `${r1(km[k])} km ${label} @ ${r1(mileage[k])} ${per}`)
  const summary = `${parts.join(' + ')} = ${r1(fuelUsed)} ${unit} × ₹${fuelPrice} = ₹${Math.round(fuelCost)} + ₹${Math.round(wear)} wear = ₹${total}`
  return {
    total,
    fuel,
    unit,
    km: { smooth: r1(km.smooth), city: r1(km.city), traffic: r1(km.traffic) },
    mileage: { smooth: r1(mileage.smooth), city: r1(mileage.city), traffic: r1(mileage.traffic) },
    fuelUsed: Math.round(fuelUsed * 100) / 100,
    fuelPrice,
    fuelCost: Math.round(fuelCost),
    wear: Math.round(wear),
    summary,
  }
}

export type Rider = { id: string; km: number; seats: number; max?: number }

const round5 = (n: number) => Math.round(n / 5) * 5
const ceil5 = (n: number) => Math.ceil(n / 5) * 5

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

/** The most a rider can pay: their share if nobody else joins, plus traffic head-room. */
export function maxFare(cost: number, driverKm: number, km: number, seats: number) {
  const alone = (cost * km * seats) / (Math.max(driverKm, 0.1) + km * seats)
  return Math.max(MIN_FARE * seats, ceil5(alone * MAX_BUFFER))
}

/** What each person pays when the car is full (for ride cards: "from ₹105"). */
export const perPersonIfFull = (cost: number, seats: number) => Math.max(MIN_FARE, round5(cost / (seats + 1)))

/** Driver's preview: what each rider pays with 1, 2, … riders going the whole way. */
export function shareTable(cost: number, seats: number) {
  return Array.from({ length: seats }, (_, i) => ({ riders: i + 1, each: Math.max(MIN_FARE, round5(cost / (i + 2))) }))
}
