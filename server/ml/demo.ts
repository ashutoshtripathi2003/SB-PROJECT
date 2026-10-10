import { haversineKm, ROAD_CIRCUITY, syntheticRoute } from '../../src/lib/geo'
import { suggestFarePerSeat } from '../../src/lib/matching'
import '../calibrate' // creates eta_samples
import { all, one, run, tx } from '../db'

/**
 * Optional demo data for presentations: 8 weeks of realistic past rides between VIT and Mumbai
 * areas, with acceptances, cancellations, no-shows and real-looking trip times. Everything is
 * tagged with ids starting "demo_" so removeDemoData() deletes all of it and nothing else.
 * Only past rides are created, so students never see demo rides in search or the feed.
 */

const CAMPUS = { id: 'vit-campus', name: 'VIT Wadala', area: 'Wadala', lat: 19.0222, lng: 72.8711, kind: 'campus' }
const AREAS: [string, string, number, number][] = [
  ['Andheri Station', 'Andheri', 19.1197, 72.8468],
  ['Dadar Station', 'Dadar', 19.0178, 72.8478],
  ['Kurla Station', 'Kurla', 19.0656, 72.8792],
  ['Chembur Station', 'Chembur', 19.0622, 72.9005],
  ['Sion Circle', 'Sion', 19.0433, 72.8634],
  ['Ghatkopar Station', 'Ghatkopar', 19.0863, 72.9081],
  ['Thane Station', 'Thane', 19.1865, 72.9757],
  ['Bandra Station', 'Bandra', 19.0544, 72.8406],
  ['Powai Hiranandani', 'Powai', 19.1176, 72.906],
  ['Vashi Station', 'Vashi', 19.0771, 72.9988],
  ['Matunga Station', 'Matunga', 19.0273, 72.8553],
  ['Borivali Station', 'Borivali', 19.2307, 72.8567],
]
const FIRST = ['Aarav', 'Priya', 'Rohan', 'Sneha', 'Karan', 'Ananya', 'Vikram', 'Isha', 'Aditya', 'Meera', 'Arjun', 'Riya', 'Siddharth', 'Neha', 'Yash', 'Pooja', 'Kabir', 'Tanvi', 'Om', 'Sara']
const LAST = ['Sharma', 'Patil', 'Iyer', 'Khan', 'Desai', 'Nair', 'Joshi', 'Mehta', 'Rao', 'Kulkarni']

/** Small deterministic random generator so demo data is the same every time. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z))

export function demoCount() {
  return {
    users: Number(one<{ n: number }>(`SELECT COUNT(*) n FROM users WHERE id LIKE 'demo\\_%' ESCAPE '\\'`)?.n ?? 0),
    rides: Number(one<{ n: number }>(`SELECT COUNT(*) n FROM rides WHERE id LIKE 'demo\\_%' ESCAPE '\\'`)?.n ?? 0),
    bookings: Number(one<{ n: number }>(`SELECT COUNT(*) n FROM bookings WHERE id LIKE 'demo\\_%' ESCAPE '\\'`)?.n ?? 0),
  }
}

export function addDemoData() {
  if (demoCount().users) return demoCount()
  const r = rng(42)
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)]
  // Anchored to noon IST today, so the same day always gives the same data whatever the time.
  const now = Math.floor((Date.now() + 5.5 * 3600_000) / 86_400_000) * 86_400_000 + 6.5 * 3600_000
  const created = new Date(now - 60 * 86_400_000).toISOString()
  const users: { id: string; flaky: number }[] = []
  tx(() => {
    for (let i = 0; i < 40; i++) {
      const id = `demo_u${i}`
      const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`
      run(
        `INSERT INTO users (id, email, name, phone, student_id, programme, gender, commute, onboarded, id_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        id,
        `ridesync.demo${i}@vit.edu.in`,
        name,
        `70000${String(10000 + i).slice(-5)}`,
        `DEMO${1000 + i}`,
        pick(['B.Tech Computer', 'B.Tech IT', 'B.Tech EXTC', 'MCA', 'B.Tech AI&DS']),
        i % 3 === 0 ? 'female' : 'male',
        i < 15 ? 'both' : 'rider',
        r() < 0.6 ? 'verified' : 'none',
        created,
      )
      // A hidden "flakiness" trait: some students cancel more — this is what the risk model must discover.
      users.push({ id, flaky: r() < 0.3 ? 0.55 : 0.03 })
      if (i < 15)
        run(`INSERT INTO vehicles (id, user_id, make, model, color, plate, seats, fuel) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, `demo_v${i}`, id, pick(['Maruti', 'Hyundai', 'Honda', 'Tata']), pick(['Swift', 'i20', 'City', 'Nexon', 'Baleno']), pick(['White', 'Grey', 'Red', 'Blue']), `MH01DM${1000 + i}`, 3, pick(['petrol', 'petrol', 'cng', 'diesel', 'ev']))
    }
    let rideN = 0
    let bookingN = 0
    for (let day = 56; day >= 1; day--) {
      const date = new Date(now - day * 86_400_000)
      const dow = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'Asia/Kolkata' }).format(date)
      const weekend = dow === 'Sat' || dow === 'Sun'
      const rides = weekend ? 2 + Math.floor(r() * 3) : 6 + Math.floor(r() * 6)
      for (let k = 0; k < rides; k++) {
        const driver = users[Math.floor(r() * 15)]
        const [name, area, lat, lng] = pick(AREAS)
        const place = { id: `demo-${area}`, name, area, lat, lng, kind: 'station' }
        const morning = r() < 0.5
        const from = morning ? place : CAMPUS
        const to = morning ? CAMPUS : place
        const hourIst = morning ? 7 + r() * 3 : 16.5 + r() * 3.5
        const depart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) + (hourIst - 5.5) * 3600_000)
        const km = haversineKm(from, to) * ROAD_CIRCUITY
        const fuel = (one<{ fuel: string }>(`SELECT fuel FROM vehicles WHERE user_id = ?`, driver.id)?.fuel ?? 'petrol') as 'petrol'
        const fare = Math.round((suggestFarePerSeat(km, 3, fuel) * (0.8 + r() * 0.5)) / 10) * 10
        const rush = !weekend && ((hourIst >= 8 && hourIst < 11) || (hourIst >= 17 && hourIst < 21))
        const speed = (weekend ? 24 : rush ? 16 : 21) * (0.85 + r() * 0.3)
        const rideId = `demo_r${rideN++}`
        const cancelledRide = r() < 0.04
        run(
          `INSERT INTO rides (id, driver_id, origin, destination, depart_at, seats_total, fare_per_seat, max_detour_km, preferences, vehicle_id, status, route, distance_km, duration_min, created_at, started_at, ended_at)
           VALUES (?, ?, ?, ?, ?, 3, ?, 3, '[]', ?, ?, ?, ?, ?, ?, ?, ?)`,
          rideId,
          driver.id,
          JSON.stringify(from),
          JSON.stringify(to),
          depart.toISOString(),
          fare,
          `demo_v${driver.id.slice(6)}`,
          cancelledRide ? 'cancelled' : 'completed',
          JSON.stringify(syntheticRoute(from, to)),
          Math.round(km * 10) / 10,
          Math.round((km / 30) * 60),
          new Date(depart.getTime() - (2 + r() * 48) * 3600_000).toISOString(),
          cancelledRide ? null : depart.toISOString(),
          cancelledRide ? null : new Date(depart.getTime() + (km / speed) * 3600_000 + 10 * 60_000).toISOString(),
        )
        const requests = Math.floor(r() * 4)
        let taken = 0
        for (let q = 0; q < requests; q++) {
          const rider = users[15 + Math.floor(r() * 25)] ?? users[0]
          if (rider.id === driver.id) continue
          const offKm = r() * 2.5
          const pickup = { ...from, id: `demo-p${bookingN}`, lat: from.lat + (r() - 0.5) * offKm * 0.012, lng: from.lng + (r() - 0.5) * offKm * 0.012 }
          const score = Math.round(Math.max(40, Math.min(99, 95 - offKm * 12 + (r() - 0.5) * 16)))
          const lead = 0.5 + r() * 47
          const bCreated = new Date(depart.getTime() - lead * 3600_000)
          // Drivers accept close, high-scoring requests more often (what the match model learns).
          const accept = taken < 3 && r() < sigmoid(0.09 * (score - 70) - 0.9 * offKm + 1.2)
          const id = `demo_b${bookingN++}`
          let status = accept ? 'confirmed' : r() < 0.7 ? 'rejected' : 'expired'
          let cancelledBy: string | null = null
          let reason: string | null = null
          let arrived: string | null = null
          let picked: string | null = null
          let dropped: string | null = null
          let actual: number | null = null
          if (accept) {
            taken++
            // Riders who are flaky, booked long ahead, or book at night cancel/no-show more.
            const pCancel = Math.min(0.9, rider.flaky + (lead > 24 ? 0.12 : 0) + (rush ? 0 : 0.04))
            if (cancelledRide) {
              status = 'cancelled'
              cancelledBy = 'driver'
              reason = 'Driver cancelled the ride'
            } else if (r() < pCancel) {
              status = 'cancelled'
              cancelledBy = 'rider'
              const noShow = r() < 0.4
              reason = noShow ? 'Didn’t come to the pickup (no-show)' : pick(['Plans changed', 'Found another ride', 'Class cancelled'])
              if (noShow) arrived = new Date(depart.getTime() + 5 * 60_000).toISOString()
            } else {
              status = 'completed'
              arrived = new Date(depart.getTime() + r() * 6 * 60_000).toISOString()
              picked = new Date(new Date(arrived).getTime() + r() * 3 * 60_000).toISOString()
              actual = Math.max(6, Math.round((km / speed) * 60))
              dropped = new Date(new Date(picked).getTime() + actual * 60_000).toISOString()
            }
          }
          run(
            `INSERT INTO bookings (id, ride_id, rider_id, pickup, drop_place, seats, fare, status, match_score, payment_method, payment_status, arrived_at, picked_up_at, dropped_at, cancelled_by, cancel_reason, rider_rating, driver_rating, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            id,
            rideId,
            rider.id,
            JSON.stringify(pickup),
            JSON.stringify(to),
            fare,
            status,
            score,
            accept ? pick(['cash', 'upi', 'online']) : null,
            status === 'completed' ? 'received' : 'unpaid',
            arrived,
            picked,
            dropped,
            cancelledBy,
            reason,
            status === 'completed' ? (r() < 0.85 ? 5 : 4) : null,
            status === 'completed' ? (r() < 0.8 ? 5 : 4) : null,
            bCreated.toISOString(),
            (dropped ?? bCreated.toISOString()),
          )
          if (actual && picked) {
            // What the traffic sources would have predicted: TomTom under-estimates Mumbai the most.
            run(
              `INSERT INTO eta_samples (booking_id, slot, km, shown, tomtom, ola, mappls, actual, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              id,
              'demo',
              Math.round(km * 10) / 10,
              null,
              Math.round(actual * (rush ? 0.5 : 0.7) * (0.85 + r() * 0.3)),
              Math.round(actual * (rush ? 0.78 : 0.88) * (0.9 + r() * 0.2)),
              Math.round(actual * 0.8 * (0.9 + r() * 0.2)),
              actual,
              picked,
            )
          }
        }
      }
    }
  })
  return demoCount()
}

export function removeDemoData() {
  const before = demoCount()
  const like = `'demo\\_%' ESCAPE '\\'`
  tx(() => {
    run(`DELETE FROM eta_samples WHERE booking_id LIKE ${like}`)
    run(`DELETE FROM messages WHERE booking_id LIKE ${like}`)
    run(`DELETE FROM wallet_tx WHERE user_id LIKE ${like}`)
    run(`DELETE FROM notifications WHERE user_id LIKE ${like}`)
    run(`DELETE FROM bookings WHERE id LIKE ${like} OR rider_id LIKE ${like}`)
    run(`DELETE FROM rides WHERE id LIKE ${like}`)
    run(`DELETE FROM vehicles WHERE id LIKE ${like}`)
    run(`DELETE FROM sessions WHERE user_id LIKE ${like}`)
    run(`DELETE FROM users WHERE id LIKE ${like}`)
  })
  return before
}

/** For tests: everything still left with a demo tag (should be zero after removal). */
export const demoLeftovers = () => all(`SELECT 'users' t, id FROM users WHERE id LIKE 'demo\\_%' ESCAPE '\\' UNION ALL SELECT 'rides', id FROM rides WHERE id LIKE 'demo\\_%' ESCAPE '\\' UNION ALL SELECT 'bookings', id FROM bookings WHERE id LIKE 'demo\\_%' ESCAPE '\\'`)
