/**
 * CO₂ saved by sharing a ride, worked out from the distance each rider actually travelled:
 *
 *   kg CO₂ saved = rider's km × seats ÷ km a litre × 2.31 kg CO₂ a litre
 *
 * Each shared seat is a trip that would otherwise have needed its own car for those km. 2.31 kg is the
 * CO₂ from burning one litre of petrol; 10 km a litre is a petrol car in Mumbai city traffic (well below
 * the brochure figure, so the estimate stays on the safe side of real-world mileage spread).
 */

/** kg of CO₂ from burning one litre of petrol. */
export const CO2_KG_PER_LITRE = 2.31
/** A petrol car in Mumbai city traffic. */
export const CITY_KM_PER_LITRE = 10

/** kg of CO₂ saved by `seats` people sharing `km` instead of each driving, to one decimal place. */
export function co2SavedKg(km: number, seats = 1): number {
  if (!(km > 0) || !(seats > 0)) return 0
  return Math.round(((km * seats) / CITY_KM_PER_LITRE) * CO2_KG_PER_LITRE * 10) / 10
}

/** SQL for the km a booking `b` (joined to its ride `r`) covered: what the rider booked, else the whole trip. */
export const BOOKING_KM_SQL = 'COALESCE(b.rider_km, b.share_km, r.distance_km, 0)'
