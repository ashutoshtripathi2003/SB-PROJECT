import { db, one, run } from './db'
import { DEFAULT_PETROL, fuelCost, fuelPrice, perSeatKmFromPetrol, type FuelType } from './fuel'

/**
 * Fares: riders share what the trip really costs the car, and nothing more.
 *
 *   trip cost  = fuel for the km (km ÷ the car's real mileage) + fuel burned standing in the forecast traffic
 *                (minutes × litres an hour idling), × today's fuel price, + tolls and parking
 *   each pays  = trip cost × their km ÷ everyone's km (driver included): an equal share per km in the car
 *
 * A rider books at their share with the riders already in, plus a 10% cushion for a worse jam than forecast; that
 * is the most they can ever pay. It drops as more riders join, and at the start the live traffic sets the final
 * cost (only ever lower). The driver pays their own share. No platform fee, no profit: it's cost-sharing.
 *
 * FARE_MODE=seat switches new rides to the BlaBlaCar way instead: a fixed price per seat from the distance
 * (km × fuel price ÷ mileage ÷ 4 people) that the driver may set from half to one and a half times.
 */

/** perSeatKm: ₹ per km per seat (FARE_MODE=seat). perKm / perMin: kept for older apps; trip costs now come from fuel. */
export type FareRates = { perSeatKm: number; perKm: number; perMin: number }

export const DEFAULT_RATES: FareRates = { perSeatKm: perSeatKmFromPetrol(DEFAULT_PETROL), perKm: 7, perMin: 1 }
/** What the admin may set them to. */
export const RATE_LIMITS = { perSeatKm: { min: 0.5, max: 10 }, perKm: { min: 1, max: 50 }, perMin: { min: 0, max: 10 } }

/** Cushion in the booked price, so a worse jam on the day than forecast doesn't cost the driver. */
export const CUSHION = 1.1
export const MIN_FARE = 30

db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)

/** What is stored: the rates, and whether ₹ per km per seat follows the petrol price (the default). */
type Stored = Partial<FareRates> & { perSeatKmAuto?: boolean }

function stored(): Stored {
  const row = one<{ value: string }>(`SELECT value FROM settings WHERE key = 'fare_rates'`)
  try {
    return row ? (JSON.parse(row.value) as Stored) : {}
  } catch {
    return {}
  }
}

/** True when ₹ per km per seat follows the real petrol price; false when the admin has set it. */
export const perSeatKmAuto = () => stored().perSeatKmAuto !== false

const clampRate = (n: number) => Math.min(RATE_LIMITS.perSeatKm.max, Math.max(RATE_LIMITS.perSeatKm.min, n))

export function fareRates(): FareRates {
  const s = stored()
  const rates = { ...DEFAULT_RATES, perKm: s.perKm ?? DEFAULT_RATES.perKm, perMin: s.perMin ?? DEFAULT_RATES.perMin }
  rates.perSeatKm = s.perSeatKmAuto === false && s.perSeatKm != null ? s.perSeatKm : clampRate(perSeatKmFromPetrol(fuelPrice().petrol))
  return rates
}

/**
 * ₹ per km per seat for this car: its fuel's price ÷ its km per unit (the driver's own figure, else the typical
 * city figure) ÷ 4 people. The admin's own rate, when set, is used for every car.
 */
export function rateFor(vehicle?: { fuel: FuelType; mileage?: number }) {
  const cost = fuelCost(vehicle?.fuel ?? 'petrol', vehicle?.mileage)
  return perSeatKmAuto() ? { ...cost, auto: true } : { ...cost, perSeatKm: fareRates().perSeatKm, auto: false }
}
export type Rate = ReturnType<typeof rateFor>

/** Saves rates. Setting perSeatKm switches it to the admin's own rate; `auto: true` hands it back to the petrol price. */
export function setFareRates(p: Partial<FareRates> & { auto?: boolean }) {
  const { auto, ...rates } = p
  const next: Stored = { ...stored(), ...rates }
  if (auto != null) next.perSeatKmAuto = auto
  else if (rates.perSeatKm != null) next.perSeatKmAuto = false
  run(`INSERT INTO settings (key, value) VALUES ('fare_rates', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, JSON.stringify(next))
}

export type RouteLike = { distanceKm: number; durationMin: number; trafficDelayMin?: number }

export type TripCost = {
  /** What the trip really costs the car: its fuel (driving + standing in traffic) plus tolls and parking. */
  total: number
  km: number
  min: number
  /** Minutes of the trip spent in traffic (part of `min`), from the traffic forecast for the departure time. */
  trafficMin: number
  fuel: FuelType
  label: string
  unit: 'litre' | 'kg' | 'kWh'
  /** ₹ per litre (kg, kWh) today. */
  price: number
  /** The car's km per unit: the driver's own figure (`ownMileage`) or the typical Mumbai figure. */
  kmPerUnit: number
  ownMileage: boolean
  idlePerHour: number
  /** Fuel for the km, fuel burned standing in traffic, and both (litres, kg or kWh). */
  drivingUnits: number
  trafficUnits: number
  units: number
  fuelCost: number
  tolls: number
  /** ₹ of fuel per km driven and per minute in traffic; distanceCost + timeCost = fuelCost. */
  perKm: number
  perMin: number
  distanceCost: number
  timeCost: number
  /** One line people can check: "25 km ÷ 7 km/L = 3.57 L + 30 min in traffic × 0.8 L/h = 0.4 L → 3.97 L × ₹111.21 = ₹442" */
  summary: string
}

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * The real cost of driving this route in this car: the fuel for its km at the car's mileage, plus the fuel it burns
 * standing in the forecast traffic, times today's fuel price, plus any tolls and parking the driver pays.
 */
export function tripCost(route: RouteLike, car?: { fuel: FuelType; mileage?: number }, tolls = 0): TripCost {
  const km = r1(Math.max(0, route.distanceKm))
  const min = Math.max(0, Math.round(route.durationMin))
  const trafficMin = Math.max(0, Math.min(min, Math.round(route.trafficDelayMin ?? 0)))
  const f = fuelCost(car?.fuel ?? 'petrol', car?.mileage)
  const drivingUnits = km / f.kmPerUnit
  const trafficUnits = (trafficMin / 60) * f.idlePerHour
  const units = drivingUnits + trafficUnits
  const fuel = units * f.price
  const toll = Math.max(0, Math.round(tolls))
  const total = Math.round(fuel + toll)
  const u = f.unit === 'litre' ? 'L' : f.unit
  const traffic = trafficMin ? ` + ${trafficMin} min in traffic × ${f.idlePerHour} ${u}/h = ${r2(trafficUnits)} ${u}` : ''
  return {
    total,
    km,
    min,
    trafficMin,
    fuel: f.fuel,
    label: f.label,
    unit: f.unit,
    price: f.price,
    kmPerUnit: f.kmPerUnit,
    ownMileage: f.ownMileage,
    idlePerHour: f.idlePerHour,
    drivingUnits: r2(drivingUnits),
    trafficUnits: r2(trafficUnits),
    units: r2(units),
    fuelCost: Math.round(fuel),
    tolls: toll,
    perKm: r2(f.price / f.kmPerUnit),
    perMin: r2((f.idlePerHour * f.price) / 60),
    distanceCost: Math.round(drivingUnits * f.price),
    timeCost: Math.round(trafficUnits * f.price),
    summary:
      `${km} km ÷ ${f.kmPerUnit} km/${u} = ${r2(drivingUnits)} ${u}${traffic} → ${r2(units)} ${u} of ${f.label.toLowerCase()} × ₹${f.price} = ₹${Math.round(fuel)}` +
      (toll ? ` + ₹${toll} tolls/parking = ₹${total}` : ''),
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
/** How new rides are priced: 'share' (the trip's real cost split among everyone in the car, the default) or 'seat' (BlaBlaCar-style). */
export const fareMode = (): FareMode => (process.env.FARE_MODE === 'seat' ? 'seat' : 'share')

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

/**
 * What the same trip would cost one person by Mumbai auto or black-and-yellow taxi on the meter (approximate:
 * auto ₹26 for the first 1.5 km then ₹17.14 a km, taxi ₹31 then ₹20.66 a km), so riders can see what sharing saves.
 */
export function meterFares(km: number) {
  const meter = (base: number, perKm: number) => Math.round(base + Math.max(0, km - 1.5) * perKm)
  return { auto: meter(26, 17.14), taxi: meter(31, 20.66) }
}

/** The driver's own share: the trip cost minus what the riders pay (the driver pays it themselves). */
export const driverShare = (cost: number, ridersPay: number) => Math.max(0, Math.round(cost - ridersPay))

/** Driver's preview: what each rider pays with 1, 2, … riders going the whole way. */
export function shareTable(cost: number, seats: number) {
  return Array.from({ length: seats }, (_, i) => ({ riders: i + 1, each: Math.max(MIN_FARE, round5(cost / (i + 2))) }))
}
