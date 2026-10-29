import { FUELS, fuelCost, type FuelType } from './fuel'

/**
 * CO₂ saved by sharing a ride. A shared seat saves the trip the rider would otherwise have made on their own;
 * carrying them adds only the driver's detour to pick them up and drop them off:
 *
 *   kg CO₂ saved = rider's km × seats × kg/km of how they used to travel − detour km × kg/km of the driver's car
 *
 * How the rider used to travel is their answer in Profile ("How did you usually get to college?"):
 *   own car  — their car's fuel and mileage (a typical petrol car if they have none in the app)
 *   cab      — a typical petrol car in city traffic: 2.31 kg a litre ÷ 10 km a litre = 0.231 kg/km
 *   auto     — a CNG auto-rickshaw: 2.75 kg a kg of CNG ÷ about 27 km a kg ≈ 0.10 kg/km
 *   bike     — a petrol two-wheeler: 2.31 kg a litre ÷ about 45 km a litre ≈ 0.05 kg/km
 *   train, bus, walk — nothing is saved (these are already low-carbon; moving people into cars is not a saving)
 * With no answer yet, a car or cab trip is assumed. A car's kg/km comes from its fuel (src/lib/fuel.ts): petrol
 * 2.31, diesel 2.68 kg a litre, CNG 2.75 kg a kg, electricity 0.72 kg a kWh (India's grid), ÷ its km per unit.
 */

export type TravelMode = 'car' | 'cab' | 'auto' | 'bike' | 'train' | 'bus' | 'walk'
export const TRAVEL_MODES: TravelMode[] = ['car', 'cab', 'auto', 'bike', 'train', 'bus', 'walk']

/** kg of CO₂ from burning one litre of petrol. */
export const CO2_KG_PER_LITRE = FUELS.petrol.co2PerUnit
/** A petrol car in Mumbai city traffic. */
export const CITY_KM_PER_LITRE = FUELS.petrol.kmPerUnit
/** A typical petrol car (or cab) in city traffic: 0.231 kg/km. */
export const CAR_KG_PER_KM = Math.round((CO2_KG_PER_LITRE / CITY_KM_PER_LITRE) * 1000) / 1000

/** kg/km for each way of travelling to college, except your own car (which uses the car's own figures). */
export const MODE_KG_PER_KM: Record<Exclude<TravelMode, 'car'>, number> = { cab: CAR_KG_PER_KM, auto: 0.1, bike: 0.05, train: 0, bus: 0, walk: 0 }

type Car = { fuel: FuelType; mileage?: number }

/** kg/km of the trip the rider no longer makes. */
export function replacedKgPerKm(mode: TravelMode | null | undefined, ownCar?: Car): number {
  if (!mode) return CAR_KG_PER_KM
  if (mode === 'car') return ownCar ? fuelCost(ownCar.fuel, ownCar.mileage).co2KgPerKm : CAR_KG_PER_KM
  return MODE_KG_PER_KM[mode] ?? CAR_KG_PER_KM
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** kg of CO₂ saved by `seats` people sharing `km` instead of each going by car or cab, to one decimal place. */
export function co2SavedKg(km: number, seats = 1, kgPerKm = CAR_KG_PER_KM): number {
  if (!(km > 0) || !(seats > 0)) return 0
  return round1(km * seats * kgPerKm)
}

/** CO₂ saved by one booking: the rider's replaced trips minus the driver's detour to carry them (never below 0). */
export function bookingCo2Kg(p: { km: number; seats: number; mode?: TravelMode | null; riderCar?: Car; detourKm?: number; driverCar?: Car }): number {
  const saved = p.km > 0 && p.seats > 0 ? p.km * p.seats * replacedKgPerKm(p.mode, p.riderCar) : 0
  const detour = Math.max(0, p.detourKm ?? 0) * fuelCost(p.driverCar?.fuel ?? 'petrol', p.driverCar?.mileage).co2KgPerKm
  return Math.max(0, round1(saved - detour))
}

/** SQL for the km a booking `b` (joined to its ride `r`) covered: what the rider booked, else the whole trip. */
export const BOOKING_KM_SQL = 'COALESCE(b.rider_km, b.share_km, r.distance_km, 0)'
/** SQL for a booking's CO₂ saved: stored when booked; older bookings count as replaced car trips. */
export const BOOKING_CO2_SQL = `COALESCE(b.co2_kg, b.seats * ${BOOKING_KM_SQL} * ${CAR_KG_PER_KM})`
