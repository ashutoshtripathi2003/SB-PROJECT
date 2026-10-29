import { describe, expect, it } from 'vitest'
import { CITY_KM_PER_LITRE, CO2_KG_PER_LITRE, co2SavedKg } from '../co2'

describe('CO₂ saved', () => {
  it('follows the distance each rider travels', () => {
    expect(CO2_KG_PER_LITRE).toBe(2.31)
    expect(CITY_KM_PER_LITRE).toBe(10)
    expect(co2SavedKg(10)).toBe(2.3) // one litre of petrol
    expect(co2SavedKg(4)).toBe(0.9)
    expect(co2SavedKg(25)).toBe(5.8)
    expect(co2SavedKg(25, 2)).toBe(11.6)
  })

  it('is zero without a distance', () => {
    expect(co2SavedKg(0)).toBe(0)
    expect(co2SavedKg(NaN)).toBe(0)
    expect(co2SavedKg(12, 0)).toBe(0)
  })
})
