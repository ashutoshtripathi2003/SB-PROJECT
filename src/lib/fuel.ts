import type { Vehicle } from './types'

/**
 * How much fuel a car really uses depends on how fast traffic lets it move: below about 30 km/h every stop and
 * start burns more per km, which is why "mileage" drops in Mumbai jams. So RideSync never asks for a mileage
 * figure. It takes the average moving speed from the traffic forecast (TomTom) and reads the fuel per 100 km for
 * that speed off a speed–fuel curve for the car's fuel and size, then adds what the engine burns in the jam minutes.
 * These figures are approximations from typical speed–fuel curves for Indian cars; the pilot will calibrate them.
 */

export type CarType = NonNullable<Vehicle['body']>

/** Bigger cars burn more: fuel per km relative to a hatchback. */
export const CAR_TYPES: Record<CarType, { label: string; examples: string; factor: number }> = {
  hatchback: { label: 'Hatchback', examples: 'Swift, i20, Baleno, Tiago', factor: 1 },
  sedan: { label: 'Sedan / compact SUV', examples: 'City, Dzire, Verna, Nexon, Brezza', factor: 1.25 },
  suv: { label: 'SUV / MUV', examples: 'Creta, XUV700, Innova, Ertiga, Scorpio', factor: 1.6 },
}

/** Litres of petrol per 100 km for a hatchback at an average moving speed (km/h). */
const PETROL_CURVE: [number, number][] = [
  [5, 17],
  [10, 12.5],
  [15, 10.5],
  [20, 9.3],
  [25, 8.5],
  [30, 7.8],
  [40, 6.8],
  [50, 6.2],
  [60, 5.9],
  [80, 6],
  [100, 6.8],
  [120, 8],
]
/** kWh per 100 km for an electric hatchback: flatter, as it doesn't burn energy standing still (apart from the AC). */
const EV_CURVE: [number, number][] = [
  [5, 16],
  [10, 14],
  [20, 12.5],
  [30, 12],
  [50, 12],
  [80, 14],
  [100, 16],
  [120, 19],
]

/**
 * Each fuel: its unit, how much of it does the work of a litre of petrol (diesel engines need less; a kg of CNG
 * goes further), what the engine burns per hour crawling in a jam with the AC on, and the CO₂ from one unit
 * (for EVs, from India's electricity grid). Prices live on the server (server/fuel.ts).
 */
export const FUEL_SPECS: Record<Vehicle['fuel'], { label: string; unit: 'litre' | 'kg' | 'kWh'; perPetrolLitre: number; jamPerHour: number; co2PerUnit: number }> = {
  petrol: { label: 'Petrol', unit: 'litre', perPetrolLitre: 1, jamPerHour: 1, co2PerUnit: 2.31 },
  diesel: { label: 'Diesel', unit: 'litre', perPetrolLitre: 0.8, jamPerHour: 0.8, co2PerUnit: 2.68 },
  cng: { label: 'CNG', unit: 'kg', perPetrolLitre: 0.74, jamPerHour: 0.75, co2PerUnit: 2.75 },
  ev: { label: 'Electric', unit: 'kWh', perPetrolLitre: 1, jamPerHour: 1, co2PerUnit: 0.72 },
}

/** A typical average moving speed in Mumbai, for figures that aren't about one trip (CO₂ per km, the admin's table). */
export const TYPICAL_KMH = 25

function interpolate(curve: [number, number][], kmh: number) {
  const v = Math.min(curve[curve.length - 1][0], Math.max(curve[0][0], kmh))
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i]
    if (v <= x1) {
      const [x0, y0] = curve[i - 1]
      return y0 + ((y1 - y0) * (v - x0)) / (x1 - x0)
    }
  }
  return curve[curve.length - 1][1]
}

/** Litres (kg, kWh) per 100 km for this fuel and car size at an average moving speed. */
export function per100(fuel: Vehicle['fuel'], body: CarType = 'hatchback', kmh = TYPICAL_KMH) {
  const size = CAR_TYPES[body]?.factor ?? 1
  if (fuel === 'ev') return interpolate(EV_CURVE, kmh) * size
  return interpolate(PETROL_CURVE, kmh) * FUEL_SPECS[fuel].perPetrolLitre * size
}

/** Units burned per hour crawling in a jam (engine running, AC on), for this fuel and car size. */
export const jamPerHour = (fuel: Vehicle['fuel'], body: CarType = 'hatchback') => FUEL_SPECS[fuel].jamPerHour * (CAR_TYPES[body]?.factor ?? 1)

/** "L", "kg", "kWh" */
export const unitShort = (fuel: Vehicle['fuel']) => (FUEL_SPECS[fuel].unit === 'litre' ? 'L' : FUEL_SPECS[fuel].unit)
