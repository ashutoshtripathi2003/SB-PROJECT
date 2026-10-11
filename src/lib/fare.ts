import type { Booking } from './types'

/**
 * Fair fares on the client. A fair-share booking's `fare` is the rider's current equal share; it can only
 * go down as riders join, never above `fareMax`, and is fixed (`fareFinal`) at drop-off from the actual trip.
 */
export const isShareBooking = (b: Booking) => b.fareMax != null

/** What a payment made now takes: online and wallet payments before the start take the maximum (the difference comes back at drop-off). */
export const payNowAmount = (b: Booking, method: 'wallet' | 'online' | 'upi' | 'cash' | null) =>
  (method === 'wallet' || method === 'online') && b.fareMax != null && !b.fareFinal ? b.fareMax : b.fare
