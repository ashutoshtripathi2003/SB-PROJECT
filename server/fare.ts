import type { Vehicle } from '../src/lib/types'
import { db, one, run } from './db'

/**
 * Fair fares: the real cost of the trip, split equally among everyone in the car.
 *
 *   trip cost  = fuel needed (the driver's own car, under this trip's traffic) + wear (tyres, servicing)
 *   each share = trip cost × (that person's km × seats) ÷ (everyone's km × seats, the driver included)
 *
 * The driver never pays more than an equal share, and nobody profits. A rider sees their share now
 * (it falls as more riders join) and a guaranteed maximum; the share becomes final at their drop-off,
 * priced from the driver's GPS track of the actual trip (trackCost) and never above the maximum.
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

/** Head-room on the maximum, so worse traffic on the day than forecast stays within it. */
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

export function tripCost(fuel: Fuel, own: Partial<Mileage>, route: RouteLike, prices = fuelPrices(), factor = 1): TripCost {
  const mileage = mileageFor(fuel, own)
  const km = conditionKm(route)
  // factor: learnt from the car's trip computer on earlier trips (1 = as the mileage says).
  const fuelUsed = factor * (km.smooth / mileage.smooth + km.city / mileage.city + km.traffic / mileage.traffic)
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

/* ---- The actual trip: cost from the driver's GPS track ------------------------------------- */

/**
 * Fuel burnt standing still with the engine on (signals, jams), per hour: diesel ~0.7 L, petrol ~0.8 L,
 * CNG ~0.8 kg, electric ~0.6 kWh (mostly the AC).
 */
export const IDLE_PER_HOUR: Record<Fuel, number> = { petrol: 0.8, diesel: 0.7, cng: 0.8, ev: 0.6 }

/** Speeds (km/h) at which the car's three mileage figures apply; in between, the mileage slides smoothly. */
const V_TRAFFIC = 10
const V_CITY = 30
const V_SMOOTH = 60

/** The car's mileage at an average speed: heavy-traffic figure at 10 km/h or less, city at 30, open-road at 60+. */
export function mileageAt(kmh: number, m: Mileage): number {
  if (kmh <= V_TRAFFIC) return m.traffic
  if (kmh <= V_CITY) return m.traffic + ((m.city - m.traffic) * (kmh - V_TRAFFIC)) / (V_CITY - V_TRAFFIC)
  if (kmh < V_SMOOTH) return m.city + ((m.smooth - m.city) * (kmh - V_CITY)) / (V_SMOOTH - V_CITY)
  return m.smooth
}

export type TrackPoint = { lat: number; lng: number; at: number /* ms */ }
export type Chunk = { t0: number; t1: number; km: number }

const R_KM = 6371
function distKm(a: TrackPoint, b: TrackPoint) {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R_KM * Math.asin(Math.sqrt(h))
}

/**
 * Turns GPS points into chunks of about a minute each (km driven, time taken), so the average speed of
 * every chunk is reliable. The phone sends a point every few seconds while moving and nothing while the
 * car stands still, so a long gap with little distance is time stuck in traffic. A gap of more than a
 * minute with real distance (the phone slept) is counted along the roads (×1.25 the straight line).
 * Jumps faster than 150 km/h are GPS glitches and are skipped.
 */
export function trackChunks(points: TrackPoint[], chunkMs = 60_000): Chunk[] {
  const pts = [...points].sort((a, b) => a.at - b.at)
  const out: Chunk[] = []
  let cur: Chunk | null = null
  let prev: TrackPoint | null = null
  for (const p of pts) {
    if (!prev) {
      prev = p
      cur = { t0: p.at, t1: p.at, km: 0 }
      continue
    }
    const dt = p.at - prev.at
    if (dt <= 0) continue
    let d = distKm(prev, p)
    if (d / (dt / 3_600_000) > 150) continue
    if (dt > 60_000 && d > 0.3) d *= 1.25
    cur!.km += d
    cur!.t1 = p.at
    prev = p
    if (cur!.t1 - cur!.t0 >= chunkMs) {
      out.push(cur!)
      cur = { t0: p.at, t1: p.at, km: 0 }
    }
  }
  if (cur && cur.t1 > cur.t0) out.push(cur)
  return out
}

/** Fuel a chunk burns: by its average speed and the car's mileage, never less than idling for that time. */
export function chunkFuel(c: Chunk, fuel: Fuel, m: Mileage, factor = 1) {
  const hours = (c.t1 - c.t0) / 3_600_000
  const kmh = hours > 0 ? c.km / hours : 0
  return factor * Math.max(c.km / mileageAt(kmh, m), IDLE_PER_HOUR[fuel] * hours)
}

export type Aboard = { id: string; seats: number; from: number; to: number; max?: number }

export type TrackCost = {
  total: number
  km: number
  fuelUsed: number
  fuelCost: number
  wear: number
  unit: string
  fuelPrice: number
  minutes: number
  stuckMinutes: number
  /** Each rider's fare (rounded, minimum, capped) and the km they rode. */
  riders: Map<string, { fare: number; exact: number; km: number; coverage: number }>
  driverShare: number
  summary: string
}

/**
 * The trip's real cost from the GPS track, and an exactly equal split: every minute of driving is paid
 * for by the people in the car during that minute (each rider by seats, the driver as one). A stretch the
 * driver drives alone (to a pickup, after the last drop) is the driver's own trip.
 */
export function trackCost(chunks: Chunk[], fuel: Fuel, own: Partial<Mileage>, aboard: Aboard[], opts: { factor?: number; prices?: Record<Fuel, number> } = {}): TrackCost {
  const m = mileageFor(fuel, own)
  const prices = opts.prices ?? fuelPrices()
  const factor = opts.factor ?? 1
  const price = prices[fuel]
  const exact = new Map<string, number>(aboard.map((a) => [a.id, 0]))
  const kmIn = new Map<string, number>(aboard.map((a) => [a.id, 0]))
  const msIn = new Map<string, number>(aboard.map((a) => [a.id, 0]))
  let fuelUsed = 0
  let km = 0
  let stuckMs = 0
  let driverShare = 0
  for (const c of chunks) {
    const f = chunkFuel(c, fuel, m, factor)
    const cost = f * price + c.km * WEAR_PER_KM[fuel]
    fuelUsed += f
    km += c.km
    const hours = (c.t1 - c.t0) / 3_600_000
    if (hours > 0 && c.km / hours < V_TRAFFIC) stuckMs += c.t1 - c.t0
    // Who was in the car for this minute (by the middle of it).
    const mid = (c.t0 + c.t1) / 2
    const inCar = aboard.filter((a) => a.from <= mid && mid < a.to)
    const heads = 1 + inCar.reduce((s, a) => s + a.seats, 0)
    driverShare += cost / heads
    for (const a of inCar) {
      exact.set(a.id, exact.get(a.id)! + (cost * a.seats) / heads)
      kmIn.set(a.id, kmIn.get(a.id)! + c.km)
      msIn.set(a.id, msIn.get(a.id)! + (c.t1 - c.t0))
    }
  }
  const riders = new Map<string, { fare: number; exact: number; km: number; coverage: number }>()
  const lastAt = chunks.length ? chunks[chunks.length - 1].t1 : 0
  for (const a of aboard) {
    const e = exact.get(a.id)!
    let fare = Math.max(MIN_FARE * a.seats, round5(e))
    // The rider's guarantee holds; anything above it stays with the driver.
    if (a.max != null && fare > a.max) fare = a.max
    // Share of the rider's time in the car that the track covers (1 = the phone reported throughout).
    const span = Math.min(a.to, lastAt) - a.from
    const coverage = span > 0 ? Math.min(1, msIn.get(a.id)! / span) : 0
    riders.set(a.id, { fare, exact: Math.round(e), km: r1(kmIn.get(a.id)!), coverage: Math.round(coverage * 100) / 100 })
  }
  const fuelCost = fuelUsed * price
  const wear = km * WEAR_PER_KM[fuel]
  const total = Math.round(fuelCost + wear)
  const minutes = chunks.length ? Math.round((chunks[chunks.length - 1].t1 - chunks[0].t0) / 60_000) : 0
  const stuck = Math.round(stuckMs / 60_000)
  const unit = FUEL_UNIT[fuel]
  const summary = `${r1(km)} km in ${minutes} min${stuck ? ` (${stuck} min crawling in traffic)` : ''} = ${r1(fuelUsed)} ${unit} × ₹${price} = ₹${Math.round(fuelCost)} + ₹${Math.round(wear)} wear = ₹${total}`
  return { total, km: r1(km), fuelUsed: Math.round(fuelUsed * 100) / 100, fuelCost: Math.round(fuelCost), wear: Math.round(wear), unit, fuelPrice: price, minutes, stuckMinutes: stuck, riders, driverShare: Math.round(driverShare), summary }
}

/**
 * Learns the car from its trip computer: the fuel it really used ÷ what RideSync worked out. Blended with
 * earlier trips (newest counts half) and kept between 0.6 and 1.6, it scales every later estimate.
 */
export function updatedFactor(old: number | null, samples: number, actualFuel: number, modelFuel: number) {
  if (!(actualFuel > 0) || !(modelFuel > 0)) return { factor: old ?? 1, samples }
  const ratio = Math.min(1.6, Math.max(0.6, actualFuel / modelFuel))
  const factor = samples > 0 && old ? old * 0.5 + ratio * 0.5 : ratio
  return { factor: Math.round(factor * 1000) / 1000, samples: samples + 1 }
}
