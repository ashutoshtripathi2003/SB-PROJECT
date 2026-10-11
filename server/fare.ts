import type { Vehicle } from '../src/lib/types'
import { db, one, run } from './db'

/**
 * Fair fares: the real cost of the trip, split equally among everyone in the car.
 *
 *   trip cost  = fuel the car needs under this trip's traffic (TomTom) × fuel price + wear (tyres, servicing)
 *   each share = trip cost × (that person's km × seats) ÷ (everyone's km × seats, the driver included)
 *
 * The car's mileage comes from its model (CARS below); the driver doesn't have to type anything.
 * A rider's price is locked when they book: their share with the traffic forecast plus a 10% cushion
 * for a worse jam on the day. It only goes down: as more riders join, and once more when the driver
 * starts the trip, if the live traffic makes the real cost lower. It never goes up.
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

/** Cushion in the booked price, so a worse jam on the day than forecast doesn't cost the driver. */
export const CUSHION = 1.1
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

/* ---- Mileage by car model --------------------------------------------------------------------- */

type Car = { make: string; model: string; fuel: Fuel; m: [number, number, number] }

/**
 * Typical real-world mileage of popular cars in India (open roads / city / heavy traffic), in km per
 * litre, per kg of CNG, or per kWh. Approximate owner-reported figures, not the brochure (ARAI) numbers,
 * which are tested on empty roads. A driver can still type their own; those always win.
 */
export const CARS: Car[] = [
  // Petrol
  { make: 'Maruti', model: 'Alto', fuel: 'petrol', m: [22, 18, 11] },
  { make: 'Maruti', model: 'WagonR', fuel: 'petrol', m: [21, 17, 10] },
  { make: 'Maruti', model: 'Swift', fuel: 'petrol', m: [21, 16, 9] },
  { make: 'Maruti', model: 'Dzire', fuel: 'petrol', m: [21, 16, 9] },
  { make: 'Maruti', model: 'Baleno', fuel: 'petrol', m: [20, 15, 8.5] },
  { make: 'Maruti', model: 'Brezza', fuel: 'petrol', m: [17, 12, 7] },
  { make: 'Maruti', model: 'Ertiga', fuel: 'petrol', m: [17, 12, 7] },
  { make: 'Maruti', model: 'Fronx', fuel: 'petrol', m: [19, 14, 8] },
  { make: 'Toyota', model: 'Glanza', fuel: 'petrol', m: [20, 15, 8.5] },
  { make: 'Hyundai', model: 'i10', fuel: 'petrol', m: [19, 14, 8] },
  { make: 'Hyundai', model: 'i20', fuel: 'petrol', m: [18, 13, 7.5] },
  { make: 'Hyundai', model: 'Venue', fuel: 'petrol', m: [17, 12, 7] },
  { make: 'Hyundai', model: 'Verna', fuel: 'petrol', m: [17, 12, 7] },
  { make: 'Hyundai', model: 'Creta', fuel: 'petrol', m: [15, 11, 6.5] },
  { make: 'Honda', model: 'Amaze', fuel: 'petrol', m: [18, 13, 7.5] },
  { make: 'Honda', model: 'City', fuel: 'petrol', m: [18, 12, 7] },
  { make: 'Tata', model: 'Tiago', fuel: 'petrol', m: [19, 14, 8] },
  { make: 'Tata', model: 'Altroz', fuel: 'petrol', m: [18, 13, 7.5] },
  { make: 'Tata', model: 'Punch', fuel: 'petrol', m: [17, 12, 7] },
  { make: 'Tata', model: 'Nexon', fuel: 'petrol', m: [16, 11, 6.5] },
  { make: 'Kia', model: 'Sonet', fuel: 'petrol', m: [16, 11, 6.5] },
  { make: 'Kia', model: 'Seltos', fuel: 'petrol', m: [15, 11, 6.5] },
  { make: 'Mahindra', model: 'XUV700', fuel: 'petrol', m: [12, 8, 5] },
  { make: 'Mahindra', model: 'Thar', fuel: 'petrol', m: [11, 8, 5] },
  // Diesel
  { make: 'Hyundai', model: 'Venue', fuel: 'diesel', m: [20, 15, 9] },
  { make: 'Hyundai', model: 'Verna', fuel: 'diesel', m: [21, 15, 9.5] },
  { make: 'Hyundai', model: 'Creta', fuel: 'diesel', m: [19, 14, 8.5] },
  { make: 'Honda', model: 'City', fuel: 'diesel', m: [22, 16, 10] },
  { make: 'Tata', model: 'Altroz', fuel: 'diesel', m: [21, 16, 9.5] },
  { make: 'Tata', model: 'Nexon', fuel: 'diesel', m: [19, 14, 8.5] },
  { make: 'Kia', model: 'Sonet', fuel: 'diesel', m: [20, 15, 9] },
  { make: 'Kia', model: 'Seltos', fuel: 'diesel', m: [18, 13, 8] },
  { make: 'Mahindra', model: 'XUV300', fuel: 'diesel', m: [18, 13, 8] },
  { make: 'Mahindra', model: 'XUV700', fuel: 'diesel', m: [15, 11, 6.5] },
  { make: 'Mahindra', model: 'Scorpio', fuel: 'diesel', m: [14, 10, 6] },
  { make: 'Mahindra', model: 'Thar', fuel: 'diesel', m: [14, 10, 6] },
  { make: 'Toyota', model: 'Innova', fuel: 'diesel', m: [13, 9.5, 6] },
  // CNG (km per kg)
  { make: 'Maruti', model: 'Alto', fuel: 'cng', m: [30, 25, 15] },
  { make: 'Maruti', model: 'WagonR', fuel: 'cng', m: [30, 24, 14] },
  { make: 'Maruti', model: 'Swift', fuel: 'cng', m: [27, 22, 13] },
  { make: 'Maruti', model: 'Dzire', fuel: 'cng', m: [28, 22, 13] },
  { make: 'Maruti', model: 'Ertiga', fuel: 'cng', m: [24, 19, 11] },
  { make: 'Hyundai', model: 'Aura', fuel: 'cng', m: [25, 20, 12] },
  { make: 'Hyundai', model: 'i10', fuel: 'cng', m: [25, 20, 12] },
  { make: 'Tata', model: 'Tiago', fuel: 'cng', m: [25, 20, 12] },
  { make: 'Tata', model: 'Punch', fuel: 'cng', m: [24, 19, 11] },
  // Electric (km per kWh)
  { make: 'Tata', model: 'Tiago', fuel: 'ev', m: [7.5, 8.5, 8.5] },
  { make: 'Tata', model: 'Punch', fuel: 'ev', m: [7, 8, 8] },
  { make: 'Tata', model: 'Nexon', fuel: 'ev', m: [6.5, 7.5, 7.5] },
  { make: 'MG', model: 'Comet', fuel: 'ev', m: [8, 9, 9] },
  { make: 'MG', model: 'ZS', fuel: 'ev', m: [6, 7, 7] },
  { make: 'Mahindra', model: 'XUV400', fuel: 'ev', m: [6, 7, 7] },
]

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The car's typical mileage by its model ("Venue", "Swift Dzire", "Grand i10 Nios" all match). */
export function carMileage(make: string, model: string, fuel: Fuel): { name: string; mileage: Mileage } | null {
  const mk = norm(make)
  const md = norm(model)
  if (!md) return null
  const hits = CARS.filter((c) => c.fuel === fuel && md.includes(norm(c.model)))
  // Prefer the same make when two makers share a model name, then the longest (most specific) name,
  // then the one named last ("Swift Dzire" is a Dzire).
  const car = hits.sort(
    (a, b) =>
      Number(mk.includes(norm(b.make))) - Number(mk.includes(norm(a.make))) ||
      b.model.length - a.model.length ||
      md.lastIndexOf(norm(b.model)) - md.lastIndexOf(norm(a.model)),
  )[0]
  return car ? { name: `${car.make} ${car.model}`, mileage: { smooth: car.m[0], city: car.m[1], traffic: car.m[2] } } : null
}

/** The mileage RideSync uses for a car: the driver's own figures, else the model's, else typical for the fuel. */
export function vehicleMileage(v: { make: string; model: string; fuel: Fuel; mileage?: Partial<Mileage> }): { mileage: Mileage; source: 'own' | 'model' | 'typical'; name?: string } {
  const own = Object.fromEntries(Object.entries(v.mileage ?? {}).filter(([, x]) => (x ?? 0) > 0)) as Partial<Mileage>
  const car = carMileage(v.make, v.model, v.fuel)
  const base = car?.mileage ?? DEFAULT_MILEAGE[v.fuel]
  const source = Object.keys(own).length ? 'own' : car ? 'model' : 'typical'
  return { mileage: mileageFor(v.fuel, { ...base, ...own }), source, name: car?.name }
}
