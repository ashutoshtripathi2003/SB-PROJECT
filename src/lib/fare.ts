import type { Booking } from './types'

/**
 * Fair fares on the client. `fareMax` is the price the rider booked at; `fare` is their price now. It only
 * goes down (more riders, or lighter live traffic when the driver starts) and is fixed (`fareFinal`) at the start.
 */
export const isShareBooking = (b: Booking) => b.fareMax != null

/** The driver's own share: the trip cost minus what the riders pay (same as the server's driverShare). */
export const driverShare = (cost: number, ridersPay: number) => Math.max(0, Math.round(cost - ridersPay))

/** What a payment made now takes: before the start, the booked price (anything lower comes back at the start). */
export const payNowAmount = (b: Booking, method: 'wallet' | 'online' | 'upi' | 'cash' | null) => (method !== 'cash' && b.fareMax != null && !b.fareFinal ? b.fareMax : b.fare)
