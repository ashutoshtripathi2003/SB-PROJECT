/**
 * RideSync AI — match scoring
 *
 * Scores how well an offered ride fits a rider's request. Every factor is a
 * bounded 0–1 signal derived from geometry, time and trust data so the score
 * can always be explained back to the rider ("Why this match?").
 *
 *   route        how much of the rider's trip lies on the driver's route,
 *                and how close the route passes to the destination
 *   time         gap between the rider's preferred time and the moment the
 *                driver reaches their pickup
 *   pickup       how far the rider's pickup is from the driver's route
 *   preference   share of the rider's preferences the ride satisfies
 *   reliability  smoothed rating + completion history (+ past rides together)
 *
 * Hard filters remove rides that cannot work at all: not enough seats, wrong
 * direction, detour beyond what the driver accepts, or > 3 h time gap.
 *
 * Weights are a starting point; in production they are learned from which
 * matches riders request and how those rides are rated (see docs/AI-MATCHING.md).
 */
import { haversineKm, polylineLengthKm, projectOnPolyline, ROAD_CIRCUITY } from './geo'
import type { Booking, Gender, LatLng, MatchFactors, MatchResult, PublicUser, Ride, RidePreference, SearchQuery, Vehicle } from './types'

export const WEIGHTS: MatchFactors = {
  route: 0.3,
  time: 0.2,
  pickup: 0.22,
  preference: 0.12,
  reliability: 0.16,
}

export const PREFERENCE_LABEL: Record<RidePreference, string> = {
  quiet: 'Quiet ride',
  female_friendly: 'Female-friendly',
  no_smoking: 'No smoking',
  no_pets: 'No pets',
  minimal_detour: 'Minimal detour',
  music_ok: 'Music on',
  ac: 'AC',
}

export type MatchInput = {
  query: SearchQuery
  ride: Ride
  route: { coords: LatLng[]; distanceKm: number; durationMin: number }
  /** Gender is used only for the Female-friendly preference and never returned. */
  driver: PublicUser & { gender?: Gender }
  vehicle: Vehicle
  /** Past bookings by this rider, used for the "ridden together" signal. */
  history?: Booking[]
  rides?: Ride[]
}

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
const decay = (d: number, scale: number) => Math.exp(-Math.pow(Math.max(0, d) / scale, 1.5))

export function tierFor(score: number): MatchResult['tier'] {
  if (score >= 85) return 'excellent'
  if (score >= 70) return 'good'
  if (score >= 55) return 'fair'
  return 'poor'
}

export const TIER_LABEL: Record<MatchResult['tier'], string> = {
  excellent: 'Excellent match',
  good: 'Good match',
  fair: 'Fair match',
  poor: 'Weak match',
}

export function desiredTime(q: SearchQuery): Date {
  if (q.at) return new Date(q.at)
  const [h, m] = q.time.split(':').map(Number)
  const d = new Date(`${q.date}T00:00:00`)
  d.setHours(h, m, 0, 0)
  return d
}

export function fmtKm(km: number) {
  return km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m` : `${km.toFixed(1)} km`
}

export function scoreRide({ query, ride, route, driver, vehicle, history = [], rides = [] }: MatchInput): MatchResult | null {
  // ---- Hard filters -------------------------------------------------------
  const seatsLeft = ride.seatsTotal - ride.seatsBooked
  if (ride.status !== 'scheduled' || seatsLeft < query.seats) return null
  if (route.coords.length < 2) return null

  const pPick = projectOnPolyline(query.pickup, route.coords)
  const pDrop = projectOnPolyline(query.drop, route.coords)
  const riderDirectKm = Math.max(0.5, haversineKm(query.pickup, query.drop) * ROAD_CIRCUITY)
  const sharedKm = pDrop.alongKm - pPick.alongKm
  // Along-route distances come from the geometry, so compare against its own length.
  const lineKm = Math.max(polylineLengthKm(route.coords), 0.1)

  // Driver must be travelling the rider's way.
  if (sharedKm < Math.min(1, riderDirectKm * 0.25)) return null

  // Driver leaves the route to the pickup and back, and again for the drop.
  const detourKm = 2 * (pPick.distanceKm + pDrop.distanceKm) * 0.9
  if (detourKm > Math.max(ride.maxDetourKm * 1.6, 2)) return null

  const pickupFraction = pPick.alongKm / lineKm
  const pickupEta = new Date(new Date(ride.departAt).getTime() + pickupFraction * route.durationMin * 60_000)
  const timeDiffMin = Math.round((pickupEta.getTime() - desiredTime(query).getTime()) / 60_000)
  if (Math.abs(timeDiffMin) > 180) return null

  // ---- Factors ------------------------------------------------------------
  const overlap = sharedKm <= riderDirectKm ? sharedKm / riderDirectKm : riderDirectKm / sharedKm
  const route_ = clamp(0.6 * Math.pow(clamp(overlap), 0.8) + 0.4 * decay(pDrop.distanceKm, 3))

  let pickup = decay(pPick.distanceKm, 2.2)
  if (detourKm > ride.maxDetourKm) pickup *= 0.8

  const time = Math.exp(-Math.pow(timeDiffMin / 45, 2))

  const unmet: RidePreference[] = []
  for (const p of query.preferences) {
    const ok =
      p === 'minimal_detour'
        ? detourKm <= 2
        : p === 'female_friendly'
          ? driver.gender === 'female' || ride.preferences.includes('female_friendly')
          : ride.preferences.includes(p)
    if (!ok) unmet.push(p)
  }
  const preference = query.preferences.length ? 1 - unmet.length / query.preferences.length : 1

  // New drivers start from a neutral 4.5★ prior until they have ratings.
  const smoothedRating = (driver.rating * driver.ratingCount + 4.5 * 5) / (driver.ratingCount + 5)
  let reliability = 0.6 * clamp((smoothedRating - 3) / 2) + 0.4 * clamp(driver.completionRate)

  const together = history.filter((b) => {
    if (b.status !== 'completed') return false
    const r = rides.find((x) => x.id === b.rideId)
    return r?.driverId === driver.id && (b.riderRating ?? 5) >= 4
  }).length
  if (together > 0) reliability = clamp(reliability + 0.05)

  const factors: MatchFactors = { route: route_, time, pickup, preference, reliability }
  let score = Math.round(
    100 *
      (WEIGHTS.route * route_ +
        WEIGHTS.time * time +
        WEIGHTS.pickup * pickup +
        WEIGHTS.preference * preference +
        WEIGHTS.reliability * reliability),
  )
  if (pPick.distanceKm > 3) score = Math.min(score, 60)
  score = clamp(score, 1, 99)

  // ---- Fare: riders pay for the share of the trip they travel ---------------
  const share = clamp(sharedKm / lineKm, 0.4, 1)
  const fare = Math.max(30, Math.ceil((ride.farePerSeat * share) / 5) * 5)

  // ---- Explanation ----------------------------------------------------------
  const first = driver.name.split(' ')[0]
  const reasons: string[] = []
  const caveats: string[] = []

  if (pPick.distanceKm <= 0.6) reasons.push(`Passes within ${fmtKm(pPick.distanceKm)} of your pickup`)
  else if (pPick.distanceKm <= 3) reasons.push(`Pickup point is ${fmtKm(pPick.distanceKm)} from you`)
  else caveats.push(`Route passes ${fmtKm(pPick.distanceKm)} from your pickup — you’d need to get to the route`)

  if (Math.abs(timeDiffMin) <= 10) reasons.push('Matches your preferred time')
  else if (Math.abs(timeDiffMin) <= 45)
    reasons.push(`Reaches your pickup ${Math.abs(timeDiffMin)} min ${timeDiffMin > 0 ? 'later' : 'earlier'} than you asked`)
  else caveats.push(`Reaches your pickup ${fmtDuration(Math.abs(timeDiffMin))} ${timeDiffMin > 0 ? 'later' : 'earlier'} than you asked`)

  if (overlap >= 0.8) reasons.push(`Shares ${Math.round(overlap * 100)}% of your route`)
  if (pDrop.distanceKm > 2.5) caveats.push(`Drop-off is ${fmtKm(pDrop.distanceKm)} from your destination`)
  if (detourKm > ride.maxDetourKm) caveats.push(`Needs a ${fmtKm(detourKm)} detour — more than ${first} usually takes`)
  if (unmet.length) caveats.push(`Doesn’t meet: ${unmet.map((p) => PREFERENCE_LABEL[p]).join(', ')}`)

  const historyText = together > 0 ? `You’ve ridden with ${first} ${together === 1 ? 'once' : `${together} times`}` : undefined

  const { gender: _gender, ...publicDriver } = driver
  return {
    ride,
    driver: publicDriver,
    vehicle,
    score,
    factors,
    tier: tierFor(score),
    pickupDistanceKm: pPick.distanceKm,
    dropDistanceKm: pDrop.distanceKm,
    timeDiffMin,
    detourKm,
    fare,
    shareFraction: clamp(sharedKm / lineKm, 0, 1),
    reasons,
    caveats,
    history: historyText,
  }
}

function fmtDuration(min: number) {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

export type SortKey = 'best' | 'earliest' | 'fare'

export function sortMatches(list: MatchResult[], key: SortKey): MatchResult[] {
  const out = [...list]
  if (key === 'best') out.sort((a, b) => b.score - a.score)
  if (key === 'earliest') out.sort((a, b) => +new Date(a.ride.departAt) - +new Date(b.ride.departAt))
  if (key === 'fare') out.sort((a, b) => a.fare - b.fare || b.score - a.score)
  return out
}

/** Suggested cost-sharing contribution per seat (not a profit-making fare). */
export function suggestFarePerSeat(distanceKm: number, seats: number, fuel: Vehicle['fuel'] = 'petrol') {
  const perKm = { petrol: 11, diesel: 10, cng: 7, ev: 5 }[fuel] // fuel + tolls + wear, ₹/km
  const raw = (distanceKm * perKm) / (seats + 1)
  return Math.max(40, Math.round(raw / 10) * 10)
}
