import type { Vehicle } from './types'

/**
 * What each fuel is measured in, a typical car's km per unit in Mumbai city traffic, the fuel burned per hour standing
 * in a jam (engine idling with the AC on), the CO₂ one unit gives off (for EVs, from India's electricity grid) and the
 * mileage a driver may enter. Prices live on the server (server/fuel.ts).
 */
export const FUEL_SPECS: Record<
  Vehicle['fuel'],
  { label: string; unit: 'litre' | 'kg' | 'kWh'; kmPerUnit: number; idlePerHour: number; co2PerUnit: number; mileage: { min: number; max: number } }
> = {
  petrol: { label: 'Petrol', unit: 'litre', kmPerUnit: 10, idlePerHour: 0.8, co2PerUnit: 2.31, mileage: { min: 2, max: 30 } },
  diesel: { label: 'Diesel', unit: 'litre', kmPerUnit: 13, idlePerHour: 0.7, co2PerUnit: 2.68, mileage: { min: 2, max: 35 } },
  cng: { label: 'CNG', unit: 'kg', kmPerUnit: 15, idlePerHour: 0.7, co2PerUnit: 2.75, mileage: { min: 4, max: 40 } },
  ev: { label: 'Electric', unit: 'kWh', kmPerUnit: 6, idlePerHour: 1, co2PerUnit: 0.72, mileage: { min: 3, max: 12 } },
}

/** "km/L", "km/kg", "km/kWh" */
export const mileageUnit = (fuel: Vehicle['fuel']) => `km/${FUEL_SPECS[fuel].unit === 'litre' ? 'L' : FUEL_SPECS[fuel].unit}`
