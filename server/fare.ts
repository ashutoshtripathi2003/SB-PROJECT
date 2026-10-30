import { db, one, run } from './db'
import { CAR_TYPES, jamPerHour, per100, unitShort, type CarType } from '../src/lib/fuel'
import { DEFAULT_PETROL, fuelCost, fuelPrice, perSeatKmFromPetrol, type FuelType } from './fuel'

/**
 * Fares: riders share what the trip really costs the car, and nothing more.
 *
 *   trip cost  = fuel for the km at the average speed the traffic forecast (TomTom) allows, read off a speed–fuel
 *                curve for the car's fuel and size, + fuel burned in the jam minutes, × today's fuel price,
 *                + tolls and parking
 *   each pays  = trip cost × their km ÷ everyone's km (driver included): an equal share per km in the car
 *
 * A rider books at their share with the riders already in, plus a 10% cushion for a worse jam than forecast; that
 * is the most they can ever pay. It drops as more riders join, and at the start the live traffic sets the final
 * cost (only ever lower). The driver pays their own share. No platform fee, no profit: it's cost-sharing.
 *
 * FARE_MODE=seat switches new rides to the BlaBlaCar way instead: a fixed price per seat from the distance
 * (km × fuel price ÷ typical km per litre ÷ 4 people) that the driver may set from half to one and a half times.
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
export function rateFor(vehicle?: { fuel: FuelType; body?: CarType }) {
  const cost = fuelCost(vehicle?.fuel ?? 'petrol', vehicle?.body)
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
  /** What the trip really costs the car: its fuel (moving + crawling in jams) plus tolls and parking. */
  total: number
  km: number
  /** Door-to-door minutes with the traffic forecast for the departure time, and the jam minutes in them. */
  min: number
  trafficMin: number
  fuel: FuelType
  label: string
  body: CarType
  carLabel: string
  unit: 'litre' | 'kg' | 'kWh'
  /** ₹ per litre (kg, kWh) today. */
  price: number
  /** Average speed while moving (km ÷ the minutes outside jams), and the fuel per 100 km at that speed. */
  speedKmh: number
  per100: number
  /** Units burned per hour crawling in a jam (engine running, AC on). */
  jamPerHour: number
  /** Fuel for the km, fuel burned in the jams, and both (litres, kg or kWh). */
  drivingUnits: number
  trafficUnits: number
  units: number
  /** What this trip works out to: km per litre (kg, kWh) overall. */
  kmPerUnit: number
  fuelCost: number
  tolls: number
  /** ₹ of fuel per km moving and per minute in jams; distanceCost + timeCost ≈ fuelCost. */
  perKm: number
  perMin: number
  distanceCost: number
  timeCost: number
  /** One line people can check. */
  summary: string
}

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * The real cost of driving this route in this car at this time. No mileage figure: the traffic forecast (TomTom)
 * gives the trip's minutes and how many of them are jams, so the average moving speed is km ÷ the other minutes.
 * The fuel per 100 km at that speed comes from the speed–fuel curve for the car's fuel and size (src/lib/fuel.ts);
 * the jam minutes add what the engine burns crawling with the AC on. Times today's fuel price, plus tolls/parking.
 */
export function tripCost(route: RouteLike, car?: { fuel: FuelType; body?: CarType }, tolls = 0): TripCost {
  const km = r1(Math.max(0, route.distanceKm))
  const min = Math.max(0, Math.round(route.durationMin))
  const trafficMin = Math.max(0, Math.min(min, Math.round(route.trafficDelayMin ?? 0)))
  const fuel = car?.fuel ?? 'petrol'
  const body = car?.body ?? 'hatchback'
  const f = fuelCost(fuel, body)
  const movingMin = Math.max(1, min - trafficMin)
  const speedKmh = km > 0 ? Math.round(km / (movingMin / 60)) : 0
  const rate = per100(fuel, body, speedKmh)
  const jam = jamPerHour(fuel, body)
  const drivingUnits = (km * rate) / 100
  const trafficUnits = (trafficMin / 60) * jam
  const units = drivingUnits + trafficUnits
  const fuelRs = units * f.price
  const toll = Math.max(0, Math.round(tolls))
  const total = Math.round(fuelRs + toll)
  const u = unitShort(fuel)
  const jams = trafficMin ? ` + ${trafficMin} min of jams × ${r2(jam)} ${u}/h = ${r2(trafficUnits)} ${u}` : ''
  return {
    total,
    km,
    min,
    trafficMin,
    fuel,
    label: f.label,
    body,
    carLabel: CAR_TYPES[body].label,
    unit: f.unit,
    price: f.price,
    speedKmh,
    per100: r2(rate),
    jamPerHour: r2(jam),
    drivingUnits: r2(drivingUnits),
    trafficUnits: r2(trafficUnits),
    units: r2(units),
    kmPerUnit: units > 0 ? r1(km / units) : 0,
    fuelCost: Math.round(fuelRs),
    tolls: toll,
    perKm: r2((rate / 100) * f.price),
    perMin: r2((jam * f.price) / 60),
    distanceCost: Math.round(drivingUnits * f.price),
    timeCost: Math.round(trafficUnits * f.price),
    summary:
      `${km} km moving at ${speedKmh} km/h → ${r2(rate)} ${u}/100 km = ${r2(drivingUnits)} ${u}${jams} → ${r2(units)} ${u} of ${f.label.toLowerCase()} × ₹${f.price} = ₹${Math.round(fuelRs)}` +
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
