import type { Vehicle } from './types'

/**
 * What each fuel is measured in, a typical car's km per unit in Mumbai city traffic, the CO₂ one unit gives off
 * (for EVs, from India's electricity grid) and the mileage a driver may enter. Prices live on the server (server/fuel.ts).
 */
export const FUEL_SPECS: Record<Vehicle['fuel'], { label: string; unit: 'litre' | 'kg' | 'kWh'; kmPerUnit: number; co2PerUnit: number; mileage: { min: number; max: number } }> = {
  petrol: { label: 'Petrol', unit: 'litre', kmPerUnit: 10, co2PerUnit: 2.31, mileage: { min: 2, max: 30 } },
  diesel: { label: 'Diesel', unit: 'litre', kmPerUnit: 13, co2PerUnit: 2.68, mileage: { min: 2, max: 35 } },
  cng: { label: 'CNG', unit: 'kg', kmPerUnit: 15, co2PerUnit: 2.75, mileage: { min: 4, max: 40 } },
  ev: { label: 'Electric', unit: 'kWh', kmPerUnit: 6, co2PerUnit: 0.72, mileage: { min: 3, max: 12 } },
}

/** "km/L", "km/kg", "km/kWh" */
export const mileageUnit = (fuel: Vehicle['fuel']) => `km/${FUEL_SPECS[fuel].unit === 'litre' ? 'L' : FUEL_SPECS[fuel].unit}`
