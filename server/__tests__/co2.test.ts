import { describe, expect, it } from 'vitest'

process.env.DATABASE_PATH = ':memory:'

const { CAR_KG_PER_KM, bookingCo2Kg, co2SavedKg, replacedKgPerKm } = await import('../co2')

describe('CO₂ saved', () => {
  it('follows the distance each rider travels in place of a car or cab trip', () => {
    expect(CAR_KG_PER_KM).toBe(0.196) // 2.31 kg a litre ÷ 11.8 km a litre (a hatchback at Mumbai speed)
    expect(co2SavedKg(10)).toBe(2)
    expect(co2SavedKg(4)).toBe(0.8)
    expect(co2SavedKg(25)).toBe(4.9)
    expect(co2SavedKg(25, 2)).toBe(9.8)
    expect(co2SavedKg(0)).toBe(0)
    expect(co2SavedKg(NaN)).toBe(0)
    expect(co2SavedKg(12, 0)).toBe(0)
  })

  it('depends on how the rider used to travel', () => {
    expect(replacedKgPerKm(undefined)).toBe(0.196) // no answer yet: a car or cab trip
    expect(replacedKgPerKm('cab')).toBe(0.196)
    expect(replacedKgPerKm('auto')).toBe(0.1)
    expect(replacedKgPerKm('bike')).toBe(0.05)
    expect(replacedKgPerKm('train')).toBe(0)
    expect(replacedKgPerKm('bus')).toBe(0)
    // Their own car: its fuel and size (a CNG hatchback: 2.75 kg ÷ 15.9 km a kg).
    expect(replacedKgPerKm('car', { fuel: 'cng' })).toBe(0.173)
    expect(replacedKgPerKm('car', { fuel: 'petrol', body: 'suv' })).toBe(0.312)
    expect(replacedKgPerKm('car')).toBe(0.196)
  })

  it("takes off the driver's detour to carry the rider", () => {
    // 25 km instead of a cab (4.9 kg) minus a 2 km detour in a petrol car (0.4 kg).
    expect(bookingCo2Kg({ km: 25, seats: 1, mode: 'cab', detourKm: 2, driverCar: { fuel: 'petrol' } })).toBe(4.5)
    // An EV driver's detour costs less.
    expect(bookingCo2Kg({ km: 25, seats: 1, mode: 'cab', detourKm: 2, driverCar: { fuel: 'ev' } })).toBe(4.7)
    // Someone who used to take the train saves nothing, and never goes below zero.
    expect(bookingCo2Kg({ km: 25, seats: 1, mode: 'train', detourKm: 2, driverCar: { fuel: 'petrol' } })).toBe(0)
  })
})
