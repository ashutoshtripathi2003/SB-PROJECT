import { randomBytes } from 'node:crypto'
import type { AppNotification, Booking, BookingStatus, NotificationKind, Place, PublicUser, Ride, User, Vehicle } from '../src/lib/types'
import { all, one, run, type Row } from './db'
import { emit, sync } from './events'
import { env } from './env'
import { sendPush } from './push'

export const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString('base64url')}`
export const nowIso = () => new Date().toISOString()
const json = <T>(v: unknown, fallback: T): T => {
  try {
    return v ? (JSON.parse(String(v)) as T) : fallback
  } catch {
    return fallback
  }
}

/** Statuses where a booking holds seats in the car. */
export const HOLDING: BookingStatus[] = ['accepted', 'confirmed', 'driver_arriving', 'driver_arrived', 'in_progress', 'completed']
export const ACTIVE: BookingStatus[] = ['pending', 'accepted', 'confirmed', 'driver_arriving', 'driver_arrived', 'in_progress']
const inList = (l: string[]) => l.map((s) => `'${s}'`).join(',')

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public field?: string,
  ) {
    super(message)
  }
}

/* ---- Users ---------------------------------------------------------------- */

export function userStats(userId: string) {
  const offered = Number(one<{ n: number }>(`SELECT COUNT(*) n FROM rides WHERE driver_id = ? AND status = 'completed'`, userId)?.n ?? 0)
  const taken = Number(one<{ n: number }>(`SELECT COUNT(*) n FROM bookings WHERE rider_id = ? AND status = 'completed'`, userId)?.n ?? 0)
  const asDriver = one<{ s: number; n: number }>(
    `SELECT COALESCE(SUM(b.rider_rating),0) s, COUNT(b.rider_rating) n FROM bookings b JOIN rides r ON r.id = b.ride_id WHERE r.driver_id = ? AND b.rider_rating IS NOT NULL`,
    userId,
  )!
  const asRider = one<{ s: number; n: number }>(`SELECT COALESCE(SUM(driver_rating),0) s, COUNT(driver_rating) n FROM bookings WHERE rider_id = ? AND driver_rating IS NOT NULL`, userId)!
  const ratingCount = Number(asDriver.n) + Number(asRider.n)
  const rating = ratingCount ? Math.round(((Number(asDriver.s) + Number(asRider.s)) / ratingCount) * 10) / 10 : 0
  const driverCancels = Number(
    one<{ n: number }>(
      `SELECT COUNT(*) n FROM rides r WHERE r.driver_id = ? AND r.status = 'cancelled' AND EXISTS (SELECT 1 FROM bookings b WHERE b.ride_id = r.id AND b.cancelled_by = 'driver' AND b.payment_method IS NOT NULL)`,
      userId,
    )?.n ?? 0,
  )
  const riderCancels = Number(one<{ n: number }>(`SELECT COUNT(*) n FROM bookings WHERE rider_id = ? AND cancelled_by = 'rider' AND payment_method IS NOT NULL`, userId)?.n ?? 0)
  const done = offered + taken
  const completionRate = done + driverCancels + riderCancels === 0 ? 1 : done / (done + driverCancels + riderCancels)
  const ridersCarried = Number(
    one<{ n: number }>(`SELECT COALESCE(SUM(b.seats),0) n FROM bookings b JOIN rides r ON r.id = b.ride_id WHERE r.driver_id = ? AND b.status = 'completed'`, userId)?.n ?? 0,
  )
  return { ridesOffered: offered, ridesTaken: taken, rating, ratingCount, completionRate, co2SavedKg: Math.round((taken + ridersCarried) * 2.4 * 10) / 10 }
}

export function vehicleFor(userId: string): Vehicle | undefined {
  const v = one(`SELECT * FROM vehicles WHERE user_id = ?`, userId)
  return v ? { id: String(v.id), make: String(v.make), model: String(v.model), color: String(v.color), plate: String(v.plate), seats: Number(v.seats), fuel: v.fuel as Vehicle['fuel'] } : undefined
}

export function getUserRow(userId: string) {
  return one(`SELECT * FROM users WHERE id = ?`, userId)
}

export function publicUser(row: Row | string): PublicUser {
  const u = typeof row === 'string' ? getUserRow(row) : row
  if (!u) return { id: String(row), name: 'Deleted user', rating: 0, ratingCount: 0, ridesOffered: 0, ridesTaken: 0, completionRate: 1 }
  const s = userStats(String(u.id))
  return {
    id: String(u.id),
    name: Number(u.deleted) ? 'Deleted user' : String(u.name),
    photo: Number(u.deleted) ? undefined : (u.photo as string) || undefined,
    programme: (u.programme as string) || undefined,
    rating: s.rating,
    ratingCount: s.ratingCount,
    ridesOffered: s.ridesOffered,
    ridesTaken: s.ridesTaken,
    completionRate: s.completionRate,
    verified: u.id_status === 'verified' || undefined,
  }
}

export const isAdmin = (email: string) => env.adminEmails.includes(email.toLowerCase())

export function meUser(row: Row): User {
  const s = userStats(String(row.id))
  return {
    ...publicUser(row),
    email: String(row.email),
    phone: String(row.phone ?? ''),
    studentId: String(row.student_id ?? ''),
    gender: (row.gender as User['gender']) ?? 'undisclosed',
    commute: (row.commute as User['commute']) || undefined,
    upiId: (row.upi_id as string) || undefined,
    preferences: json(row.preferences, []),
    emergencyContacts: json(row.emergency_contacts, []),
    vehicle: vehicleFor(String(row.id)),
    onboarded: !!Number(row.onboarded),
    co2SavedKg: s.co2SavedKg,
    createdAt: String(row.created_at),
    idStatus: ((row.id_status as string) || 'none') as User['idStatus'],
    idNote: (row.id_note as string) || undefined,
    isAdmin: isAdmin(String(row.email)) || undefined,
    adminOnly: (isAdmin(String(row.email)) && !String(row.email).endsWith(`@${env.allowedDomain}`)) || undefined,
  }
}

/* ---- Rides & bookings ---------------------------------------------------- */

export function seatsBooked(rideId: string) {
  return Number(one<{ n: number }>(`SELECT COALESCE(SUM(seats),0) n FROM bookings WHERE ride_id = ? AND status IN (${inList(HOLDING)})`, rideId)?.n ?? 0)
}

export function toRide(r: Row, opts: { location?: boolean } = {}): Ride {
  return {
    id: String(r.id),
    driverId: String(r.driver_id),
    origin: json<Place>(r.origin, {} as Place),
    destination: json<Place>(r.destination, {} as Place),
    departAt: String(r.depart_at),
    seatsTotal: Number(r.seats_total),
    seatsBooked: seatsBooked(String(r.id)),
    farePerSeat: Number(r.fare_per_seat),
    maxDetourKm: Number(r.max_detour_km),
    preferences: json(r.preferences, []),
    vehicleId: String(r.vehicle_id),
    note: (r.note as string) || undefined,
    status: r.status as Ride['status'],
    createdAt: String(r.created_at),
    distanceKm: Number(r.distance_km),
    durationMin: Number(r.duration_min),
    route: json(r.route, []),
    driverLocation: opts.location ? json(r.driver_location, undefined) : undefined,
    womenOnly: Number(r.women_only) ? true : undefined,
  }
}

export function toBooking(b: Row): Booking {
  return {
    id: String(b.id),
    rideId: String(b.ride_id),
    riderId: String(b.rider_id),
    pickup: json<Place>(b.pickup, {} as Place),
    drop: json<Place>(b.drop_place, {} as Place),
    seats: Number(b.seats),
    fare: Number(b.fare),
    status: b.status as BookingStatus,
    matchScore: Number(b.match_score),
    createdAt: String(b.created_at),
    updatedAt: String(b.updated_at),
    message: (b.message as string) || undefined,
    paymentMethod: (b.payment_method as Booking['paymentMethod']) || undefined,
    paymentStatus: (b.payment_status as Booking['paymentStatus']) || 'unpaid',
    paymentRef: (b.payment_ref as string) || undefined,
    paidAt: (b.paid_at as string) || undefined,
    arrivedAt: (b.arrived_at as string) || undefined,
    pickedUpAt: (b.picked_up_at as string) || undefined,
    droppedAt: (b.dropped_at as string) || undefined,
    cancelledBy: (b.cancelled_by as Booking['cancelledBy']) || undefined,
    cancelReason: (b.cancel_reason as string) || undefined,
    riderRating: b.rider_rating == null ? undefined : Number(b.rider_rating),
    driverRating: b.driver_rating == null ? undefined : Number(b.driver_rating),
  }
}

export function rideRow(id: string) {
  const r = one(`SELECT * FROM rides WHERE id = ?`, id)
  if (!r) throw new HttpError(404, 'This ride no longer exists.')
  return r
}

export function bookingRow(id: string) {
  const b = one(`SELECT * FROM bookings WHERE id = ?`, id)
  if (!b) throw new HttpError(404, 'This booking no longer exists.')
  return b
}

/** User ids involved in a ride: the driver plus everyone with a booking. */
export function rideParticipants(rideId: string): string[] {
  const r = one(`SELECT driver_id FROM rides WHERE id = ?`, rideId)
  const riders = all<{ rider_id: string }>(`SELECT DISTINCT rider_id FROM bookings WHERE ride_id = ?`, rideId).map((x) => x.rider_id)
  return r ? [String(r.driver_id), ...riders] : riders
}

/* ---- Messaging & notifications ------------------------------------------ */

export function systemMessage(bookingId: string, text: string) {
  run(`INSERT INTO messages (id, booking_id, sender_id, text, system, created_at) VALUES (?, ?, 'system', ?, 1, ?)`, newId('m'), bookingId, text, nowIso())
}

export function notify(userId: string, kind: NotificationKind, title: string, body: string, link?: string) {
  const n: AppNotification = { id: newId('n'), userId, kind, title, body, link, read: false, createdAt: nowIso() }
  run(`INSERT INTO notifications (id, user_id, kind, title, body, link, read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`, n.id, userId, kind, title, body, link ?? null, n.createdAt)
  emit([userId], { type: 'notification', notification: n })
  // Also to the phone's notification bar (when Firebase is set up), so it arrives with the app closed.
  void sendPush(userId, { title, body, link, kind })
}

export { sync }

export const first = (name: string) => name.split(' ')[0]

export const timeIST = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })

export const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
