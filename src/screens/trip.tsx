import { motion } from 'framer-motion'
import { Banknote, Check, CircleX, Clock, MessageCircle, Phone, RefreshCw, SearchX, Star, X } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { ConfirmDialog } from '@/components/Sheet'
import { NetworkError, StateView } from '@/components/States'
import { Stops } from '@/components/Stops'
import { TopBar } from '@/components/TopBar'
import { useCelebrate } from '@/components/Celebrate'
import { useToast } from '@/components/Toast'
import { Avatar, Badge, Button, Chip, Notice, Plate, Rating, RideCardSkeleton, VerifiedBadge } from '@/components/ui'
import { dayTime, firstName, money, plural, time } from '@/lib/format'
import type { Booking, BookingStatus } from '@/lib/types'
import { ApiError, Q, bookings, useQuery, type BookingDetail } from '@/services/api'
import { RidePinCard, ShareTripButton } from '@/components/Safety'
import { RiderLiveBar, useShareRiderLocation } from '@/components/RiderLive'
import { useSearch } from '@/state/search'

export const BOOKING_STATUS: Record<BookingStatus, { label: string; short: string; tone: 'verified' | 'success' | 'warning' | 'error' | 'info' | undefined }> = {
  pending: { label: 'Waiting for driver', short: 'Requested', tone: 'warning' },
  accepted: { label: 'Accepted · confirm payment', short: 'Pay now', tone: 'verified' },
  rejected: { label: 'Declined by driver', short: 'Declined', tone: 'error' },
  confirmed: { label: 'Confirmed', short: 'Confirmed', tone: 'success' },
  driver_arriving: { label: 'Driver on the way', short: 'Arriving', tone: 'info' },
  driver_arrived: { label: 'Driver has arrived', short: 'Arrived', tone: 'info' },
  in_progress: { label: 'On the way', short: 'Live', tone: 'success' },
  completed: { label: 'Completed', short: 'Completed', tone: undefined },
  cancelled: { label: 'Cancelled', short: 'Cancelled', tone: 'error' },
}

const CANCEL_REASONS = ['My plans changed', 'Found another ride', 'Driver asked me to cancel', 'Pickup is too far', 'Other']

export function paymentLabel(b: Booking) {
  if (!b.paymentMethod) return 'Not paid yet'
  if (b.paymentMethod === 'wallet') return b.paymentStatus === 'refunded' ? 'Paid from wallet · refunded' : 'Paid from wallet'
  if (b.paymentMethod === 'online') return b.paymentStatus === 'refunded' ? 'Paid online · refunded' : 'Paid online'
  if (b.paymentMethod === 'cash') return b.paymentStatus === 'received' ? 'Paid in cash' : 'Cash at pickup'
  return b.paymentStatus === 'received' ? 'Paid by UPI · received' : `Paid by UPI${b.paymentRef ? ` · ref ${b.paymentRef}` : ''}`
}

/** Trip summary used by booking, payment and live screens. */
export function TripSummary({ detail }: { detail: BookingDetail }) {
  const { booking, ride, driver, vehicle: v } = detail
  return (
    <div className="summary">
      <div className="row gap-3">
        <Avatar name={driver.name} src={driver.photo} size="lg" verified={driver.verified} />
        <div className="stack grow gap-1" style={{ minWidth: 0 }}>
          <span className="t-h3 truncate">{driver.name}</span>
          <Rating value={driver.rating} count={driver.ridesOffered} />
        </div>
        {driver.verified && <VerifiedBadge short />}
      </div>
      <div className="vehicle-row">
        <span className="stack grow">
          <span className="t-body t-strong">
            {v.color} {v.make} {v.model}
          </span>
          <span className="t-sm t-muted">{plural(booking.seats, 'seat')} booked</span>
        </span>
        <Plate>{v.plate}</Plate>
      </div>
      <hr className="divider" />
      <Stops from={{ title: booking.pickup.name, subtitle: booking.pickup.area, time: time(ride.departAt) }} to={{ title: booking.drop.name, subtitle: booking.drop.area }} />
      <div className="row row--between t-sm t-muted">
        <span className="row gap-2">
          <Clock size={15} />
          {dayTime(ride.departAt)}
        </span>
        <span>{booking.matchScore}% AI match</span>
      </div>
      <hr className="divider" />
      <div className="bill">
        <div className="bill__row">
          <span>{booking.fareMax == null ? 'Cost share' : booking.fareFinal ? 'Your final price' : 'Your price'}</span>
          <span>{money(booking.fare)}</span>
        </div>
        {booking.fareMax != null && !booking.fareFinal && (
          <div className="bill__row t-sm" style={{ color: 'var(--ink-500)' }}>
            <span>Never goes up · drops if more riders join, or when the trip starts if traffic is lighter{booking.fare < booking.fareMax ? ` · booked at ${money(booking.fareMax)}` : ''}</span>
          </div>
        )}
        {ride.costTotal != null && booking.fareMax != null && (
          <div className="bill__row t-sm" style={{ color: 'var(--ink-500)' }}>
            <span>Trip cost {money(ride.costTotal)}{ride.costSummary ? ` — ${ride.costSummary}` : ''}</span>
          </div>
        )}
        <div className="bill__row">
          <span>Platform fee</span>
          <span className="t-success">Free</span>
        </div>
        <div className="bill__row bill__row--total">
          <span>Total</span>
          <span>{money(booking.fare)}</span>
        </div>
        {booking.paidAmount != null && booking.paidAmount !== booking.fare && booking.fareFinal && !booking.settleDue && (
          <div className="bill__row t-sm" style={{ color: 'var(--success-600)' }}>
            <span>You paid {money(booking.paidAmount)}; {money(booking.paidAmount - booking.fare)} is coming back to you.</span>
          </div>
        )}
        {!!booking.settleDue && (
          <div className="bill__row t-sm" style={{ color: 'var(--warning-600)' }}>
            <span>{booking.settleDue < 0 ? `The driver returns ${money(-booking.settleDue)} to you.` : `Pay the driver ${money(booking.settleDue)} more.`}</span>
          </div>
        )}
        <div className="row row--between t-sm t-muted" style={{ marginTop: 4 }}>
          <span>{paymentLabel(booking)}</span>
          {(booking.paymentStatus === 'received' || booking.paymentStatus === 'paid_online') && (
            <Badge tone="success" icon={<Check />}>
              Received
            </Badge>
          )}
        </div>
      </div>
    </div>
  )
}

export function TripStatus() {
  const { bookingId } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const celebrate = useCelebrate()
  const search = useSearch()
  const q = useQuery<BookingDetail>(bookingId ? Q.booking(bookingId) : null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState(CANCEL_REASONS[0])
  const [cancelling, setCancelling] = useState(false)
  // In the last 30 min before a confirmed ride, help the driver find you (as on the live screen).
  const soon = !!q.data && q.data.role === 'rider' && q.data.booking.status === 'confirmed' && new Date(q.data.ride.departAt).getTime() - Date.now() < 30 * 60_000
  const shareMe = useShareRiderLocation(bookingId ?? '', soon)

  if (q.loading)
    return (
      <div className="page">
        <div className="page__content page__content--narrow stack gap-3" style={{ paddingTop: 40 }}>
          <RideCardSkeleton />
        </div>
      </div>
    )
  if (q.error?.code === 'network' && !q.data) return <div className="page" style={{ justifyContent: 'center' }}><NetworkError onRetry={q.reload} /></div>
  if (!q.data) {
    return (
      <div className="page" style={{ justifyContent: 'center' }}>
        <StateView icon={<SearchX />} tone="neutral" title="Booking not found" body={q.error?.message} actions={<Button block onClick={() => nav('/rides')}>Go to My Rides</Button>} />
      </div>
    )
  }
  const detail = q.data
  if (detail.role === 'driver') return <Navigate to={`/drive/${detail.ride.id}`} replace />
  const { booking, driver } = detail
  if (['driver_arriving', 'driver_arrived', 'in_progress'].includes(booking.status)) return <Navigate to={`/live/${booking.id}`} replace />
  const name = firstName(driver.name)

  async function doCancel() {
    setCancelling(true)
    try {
      await bookings.cancel(booking.id, booking.status === 'pending' ? 'Request withdrawn' : reason)
      setCancelOpen(false)
      celebrate({ kind: 'cancelled', title: booking.status === 'pending' ? 'Request withdrawn' : 'Seat cancelled', body: booking.paymentStatus === 'paid_online' ? 'Your online payment will be refunded automatically.' : 'The driver has been notified.' })
    } catch (e) {
      toast({ tone: 'error', message: e instanceof ApiError ? e.message : 'Couldn’t cancel' })
    } finally {
      setCancelling(false)
    }
  }

  const findAnother = () => {
    if (search.query) void search.run(search.query)
    nav(search.query ? '/find/results' : '/find')
  }

  const hero = (() => {
    switch (booking.status) {
      case 'pending':
        return (
          <Hero
            mark={
              <div className="radar">
                <span className="radar__ring" />
                <span className="radar__ring" />
                <span className="radar__ring" />
                <Avatar name={driver.name} src={driver.photo} size="xl" />
              </div>
            }
            title="Ride requested"
            body={`Waiting for ${name} to accept. You’ll get a notification the moment they respond.`}
          />
        )
      case 'accepted':
        return <Hero mark={<SuccessMark />} title="Ride confirmed" body={`${name} accepted your request. Choose how you’ll pay to lock in your seat.`} />
      case 'confirmed':
        return <Hero mark={<SuccessMark />} title="You’re all set" body={`${name} will pick you up at ${booking.pickup.name}, ${dayTime(detail.ride.departAt).toLowerCase()}. You can track them live once they start.`} />
      case 'rejected':
        return <Hero mark={<div className="result-mark result-mark--error"><X /></div>} title={`${name} couldn’t take this ride`} body="This happens when plans change or seats fill up. You haven’t paid anything." />
      case 'cancelled':
        return (
          <Hero
            mark={<div className="result-mark result-mark--error"><CircleX /></div>}
            title="Ride cancelled"
            body={`${booking.cancelledBy === 'rider' ? `You cancelled this ride${booking.cancelReason ? ` · ${booking.cancelReason}` : ''}.` : `${booking.cancelReason ?? 'The ride was cancelled'}.`}${booking.paymentStatus === 'refunded' ? ' Your online payment has been refunded (5–7 working days).' : booking.paymentStatus === 'paid_online' ? ' Your online refund is being processed.' : booking.cancelledBy !== 'rider' && booking.paymentStatus !== 'unpaid' ? ` Ask ${name} to refund your UPI payment.` : ''}`}
          />
        )
      case 'completed':
        return <Hero mark={<div className="result-mark result-mark--brand"><Check /></div>} title="Trip completed" body={booking.co2Kg ? `Thanks for riding with ${name}. Sharing ${booking.riderKm} km saved about ${booking.co2Kg.toFixed(1)} kg of CO₂.` : `Thanks for riding with ${name}.`} />
      default:
        return null
    }
  })()

  const footer = (() => {
    switch (booking.status) {
      case 'pending':
        return (
          <Button size="lg" variant="secondary" block onClick={() => setCancelOpen(true)}>
            Withdraw request
          </Button>
        )
      case 'accepted':
        return (
          <Button size="lg" block onClick={() => nav(`/pay/${booking.id}`)}>
            Continue to Payment
          </Button>
        )
      case 'confirmed':
        return (
          <div className="stack gap-2">
            <div className="row gap-2">
              <Button variant="secondary" block icon={<MessageCircle />} onClick={() => nav(`/chat/${booking.id}`)}>
                Message {name}
              </Button>
              {detail.driverPhone && (
                <a className="btn btn--secondary" href={`tel:+91${detail.driverPhone}`} aria-label={`Call ${name}`}>
                  <span className="btn__label">
                    <Phone />
                  </span>
                </a>
              )}
            </div>
            <ShareTripButton bookingId={booking.id} block />
            {booking.paymentMethod === 'cash' && detail.driverUpiId && (
              <Button variant="ghost" block icon={<Banknote />} onClick={() => nav(`/pay/${booking.id}`)}>
                Pay by UPI instead
              </Button>
            )}
            <Button variant="danger-ghost" block onClick={() => setCancelOpen(true)}>
              Cancel seat
            </Button>
          </div>
        )
      case 'rejected':
      case 'cancelled':
        return (
          <Button size="lg" block icon={<RefreshCw />} onClick={findAnother}>
            Find another match
          </Button>
        )
      case 'completed':
        return booking.riderRating ? (
          <Button size="lg" variant="secondary" block onClick={() => nav('/rides')}>
            Back to My Rides
          </Button>
        ) : (
          <Button size="lg" block icon={<Star />} onClick={() => nav(`/live/${booking.id}`)}>
            Rate your trip
          </Button>
        )
      default:
        return null
    }
  })()

  return (
    <div className="page">
      <TopBar title={BOOKING_STATUS[booking.status].label} backTo="/rides" actions={<span className="topbar__spacer" />} />
      <div className="page__content page__content--narrow">
        <motion.div key={booking.status} initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}>
          {hero}
        </motion.div>
        {booking.status === 'pending' && (
          <div className="progress progress--indeterminate" style={{ margin: '0 auto 24px', maxWidth: 200 }}>
            <div className="progress__bar" />
          </div>
        )}
        {booking.status === 'accepted' && (
          <div style={{ marginBottom: 16 }}>
            <Notice tone="info" icon={<Clock />}>
              Pay to lock in your seat — online, by UPI to {name}, or in cash at pickup.
            </Notice>
          </div>
        )}
        {shareMe.state !== 'off' && (
          <div style={{ marginBottom: 12 }}>
            <RiderLiveBar driver={name} share={shareMe} />
          </div>
        )}
        {detail.ridePin && booking.status !== 'accepted' && (
          <div style={{ marginBottom: 16 }}>
            <RidePinCard pin={detail.ridePin} plate={detail.vehicle.plate} />
          </div>
        )}
        <div className="page__sheet-lite">
          <TripSummary detail={detail} />
        </div>
      </div>
      {footer && <div className="page__footer page__footer--narrow">{footer}</div>}

      <ConfirmDialog
        open={cancelOpen}
        title={booking.status === 'pending' ? 'Withdraw this request?' : 'Cancel your seat?'}
        body={
          booking.status === 'pending'
            ? `${name} will no longer see your request.`
            : `${name} will be notified.${booking.paymentStatus === 'paid_online' ? ' Your online payment will be refunded automatically.' : booking.paymentStatus !== 'unpaid' ? ' Since you’ve paid by UPI, ask them to refund you.' : ''} Frequent cancellations lower your reliability score.`
        }
        confirmLabel={booking.status === 'pending' ? 'Withdraw request' : 'Cancel seat'}
        cancelLabel="Keep it"
        destructive
        loading={cancelling}
        onConfirm={doCancel}
        onClose={() => setCancelOpen(false)}
      >
        {booking.status !== 'pending' && (
          <div className="stack gap-2" style={{ marginTop: 12 }}>
            <span className="field__label">Reason</span>
            <div className="row wrap gap-2">
              {CANCEL_REASONS.map((r) => (
                <Chip key={r} size="sm" selected={reason === r} onClick={() => setReason(r)}>
                  {r}
                </Chip>
              ))}
            </div>
          </div>
        )}
      </ConfirmDialog>
    </div>
  )
}

function Hero({ mark, title, body }: { mark: React.ReactNode; title: string; body: string }) {
  return (
    <div className="hero">
      {mark}
      <h2 className="t-h1">{title}</h2>
      <p className="t-body t-muted" style={{ maxWidth: 340 }}>
        {body}
      </p>
    </div>
  )
}

export function SuccessMark() {
  return (
    <motion.div className="result-mark" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 18 }}>
      <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.15, duration: 0.35, ease: 'easeOut' }} />
      </svg>
    </motion.div>
  )
}

export function StatusBadge({ status }: { status: BookingStatus }) {
  const s = BOOKING_STATUS[status]
  return <Badge tone={s.tone}>{s.short}</Badge>
}
