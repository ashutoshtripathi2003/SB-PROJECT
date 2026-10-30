import { motion } from 'framer-motion'
import { Check, CircleX, Clock, MessageCircle, Phone, RefreshCw, SearchX, Star, X } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { ConfirmDialog } from '@/components/Sheet'
import { NetworkError, StateView } from '@/components/States'
import { Stops } from '@/components/Stops'
import { TopBar } from '@/components/TopBar'
import { useCelebrate } from '@/components/Celebrate'
import { useToast } from '@/components/Toast'
import { Avatar, Badge, Button, Chip, Plate, Rating, RideCardSkeleton, VerifiedBadge, cx } from '@/components/ui'
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

  const head = (() => {
    switch (booking.status) {
      case 'pending':
        return {
          mark: (
            <div className="radar radar--sm">
              <span className="radar__ring" />
              <span className="radar__ring" />
              <span className="radar__ring" />
              <Avatar name={driver.name} src={driver.photo} size="lg" />
            </div>
          ),
          title: `Waiting for ${name}`,
          body: 'Your request is sent. You’ll hear a chime the moment they accept.',
        }
      case 'accepted':
        return { mark: <SuccessMark />, title: `${name} accepted!`, body: 'One last step: confirm your seat by choosing how you’ll pay.' }
      case 'confirmed':
        return { mark: <SuccessMark />, title: 'Seat confirmed', body: `Pickup at ${booking.pickup.name} · ${dayTime(detail.ride.departAt)}` }
      case 'rejected':
        return { mark: <div className="result-mark result-mark--error"><X /></div>, title: `${name} couldn’t take this ride`, body: 'Plans change or seats fill up. You haven’t paid anything.' }
      case 'cancelled':
        return {
          mark: <div className="result-mark result-mark--error"><CircleX /></div>,
          title: 'Ride cancelled',
          body: `${booking.cancelledBy === 'rider' ? `You cancelled this ride${booking.cancelReason ? ` · ${booking.cancelReason}` : ''}.` : `${booking.cancelReason ?? 'The ride was cancelled'}.`}${booking.paymentStatus === 'refunded' ? ' Your online payment has been refunded (5–7 working days).' : booking.paymentStatus === 'paid_online' ? ' Your online refund is being processed.' : booking.cancelledBy !== 'rider' && booking.paymentStatus !== 'unpaid' ? ` Ask ${name} to refund your UPI payment.` : ''}`,
        }
      case 'completed':
        return {
          mark: <div className="result-mark result-mark--brand"><Check /></div>,
          title: 'Trip completed',
          body: booking.co2Kg ? `Thanks for riding with ${name}. Sharing ${booking.riderKm} km saved about ${booking.co2Kg.toFixed(1)} kg of CO₂.` : `Thanks for riding with ${name}.`,
        }
      default:
        return null
    }
  })()
  const canContact = ['accepted', 'confirmed'].includes(booking.status)

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
          <div className="stack gap-2">
            <Button size="lg" block onClick={() => nav(`/pay/${booking.id}`)}>
              Confirm seat · {money(booking.fare)}
            </Button>
            <button type="button" className="link-quiet" onClick={() => setCancelOpen(true)}>
              Cancel request
            </button>
          </div>
        )
      case 'confirmed':
        return (
          <div className="stack gap-2">
            <ShareTripButton bookingId={booking.id} block />
            <button type="button" className="link-quiet link-quiet--danger" onClick={() => setCancelOpen(true)}>
              Cancel seat
            </button>
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
    <div className="page page--canvas">
      <TopBar title="" backTo="/rides" actions={<span className="topbar__spacer" />} />
      <div className="page__content page__content--narrow booking">
        {head && (
          <motion.div key={booking.status} className="booking-head" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}>
            {head.mark}
            <h1 className="t-h1">{head.title}</h1>
            <p className="t-body t-muted">{head.body}</p>
          </motion.div>
        )}
        {!['rejected', 'cancelled'].includes(booking.status) && <StepTracker status={booking.status} />}
        {shareMe.state !== 'off' && <RiderLiveBar driver={name} share={shareMe} />}
        {detail.ridePin && booking.status === 'confirmed' && <RidePinCard pin={detail.ridePin} plate={detail.vehicle.plate} />}
        <DriverCard detail={detail} contact={canContact} />
        <div className="card-lite">
          <Stops from={{ title: booking.pickup.name, subtitle: booking.pickup.area, time: time(detail.ride.departAt) }} to={{ title: booking.drop.name, subtitle: booking.drop.area }} />
          <div className="row row--between t-sm t-muted" style={{ marginTop: 10 }}>
            <span className="row gap-2">
              <Clock size={15} />
              {dayTime(detail.ride.departAt)}
            </span>
            <span>{plural(booking.seats, 'seat')}</span>
          </div>
        </div>
        <PriceCard detail={detail} onPayUpi={booking.status === 'confirmed' && booking.paymentMethod === 'cash' && detail.driverUpiId ? () => nav(`/pay/${booking.id}`) : undefined} />
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

const STEPS = ['Requested', 'Accepted', 'Seat confirmed', 'On the way'] as const
const STEP_OF: Partial<Record<BookingStatus, number>> = { pending: 0, accepted: 1, confirmed: 2, driver_arriving: 3, driver_arrived: 3, in_progress: 3, completed: 4 }

/** Where the booking is: Requested → Accepted → Seat confirmed → On the way. */
export function StepTracker({ status }: { status: BookingStatus }) {
  const at = STEP_OF[status] ?? 0
  return (
    <ol className="steps" aria-label="Booking progress">
      {STEPS.map((label, i) => (
        <li key={label} className={cx('steps__item', i < at && 'is-done', i === at && 'is-current')} aria-current={i === at ? 'step' : undefined}>
          <span className="steps__dot">{i < at ? <Check size={12} strokeWidth={3} /> : null}</span>
          <span className="steps__label">{label}</span>
        </li>
      ))}
    </ol>
  )
}

/** The driver, their car and plate, and Call / Chat once they've accepted. */
export function DriverCard({ detail, contact }: { detail: BookingDetail; contact?: boolean }) {
  const nav = useNavigate()
  const { driver, vehicle: v, booking } = detail
  return (
    <div className="card-lite driver-card">
      <div className="row gap-3">
        <Avatar name={driver.name} src={driver.photo} size="lg" verified={driver.verified} />
        <div className="stack grow gap-1" style={{ minWidth: 0 }}>
          <span className="row gap-1" style={{ minWidth: 0 }}>
            <span className="t-h3 truncate">{driver.name}</span>
            {driver.verified && <VerifiedBadge short />}
          </span>
          <Rating value={driver.rating} count={driver.ridesOffered} />
        </div>
        {contact && (
          <div className="row gap-2">
            <button type="button" className="round-action" aria-label={`Message ${firstName(driver.name)}`} onClick={() => nav(`/chat/${booking.id}`)}>
              <MessageCircle />
            </button>
            {detail.driverPhone && (
              <a className="round-action round-action--call" href={`tel:+91${detail.driverPhone}`} aria-label={`Call ${firstName(driver.name)}`}>
                <Phone />
              </a>
            )}
          </div>
        )}
      </div>
      <div className="vehicle-row">
        <span className="stack grow">
          <span className="t-body t-strong">
            {v.color} {v.make} {v.model}
          </span>
          <span className="t-sm t-muted">{v.fuel === 'ev' ? 'Electric' : v.fuel === 'cng' ? 'CNG' : v.fuel[0].toUpperCase() + v.fuel.slice(1)}</span>
        </span>
        <Plate>{v.plate}</Plate>
      </div>
    </div>
  )
}

/** The price, big; how it's worked out folded away. */
export function PriceCard({ detail, onPayUpi }: { detail: BookingDetail; onPayUpi?: () => void }) {
  const { booking, ride } = detail
  const [open, setOpen] = useState(false)
  const share = booking.fareMax != null
  return (
    <div className="card-lite price-card">
      <div className="row row--between">
        <span className="stack">
          <span className="t-sm t-muted">{!share ? 'Cost share' : booking.fareFinal ? 'Your final price' : 'Your price'}</span>
          <span className="price-card__amount tabular">{money(booking.fare)}</span>
        </span>
        <span className="stack" style={{ alignItems: 'flex-end', gap: 4 }}>
          <span className="t-sm">{paymentLabel(booking)}</span>
          {(booking.paymentStatus === 'received' || booking.paymentStatus === 'paid_online') && (
            <Badge tone="success" icon={<Check />}>
              Received
            </Badge>
          )}
        </span>
      </div>
      {share && !booking.fareFinal && (
        <p className="t-sm t-success" style={{ marginTop: 6 }}>
          Never goes up · drops if more riders join{booking.fare < (booking.fareMax ?? 0) ? ` (booked at ${money(booking.fareMax!)})` : ''}
        </p>
      )}
      {!!booking.settleDue && (
        <p className="t-sm" style={{ marginTop: 6, color: 'var(--warning-600)' }}>
          {booking.settleDue < 0 ? `The driver returns ${money(-booking.settleDue)} to you.` : `Pay the driver ${money(booking.settleDue)} more.`}
        </p>
      )}
      <div className="row gap-3" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        {ride.costTotal != null && share && (
          <button type="button" className="link-quiet" style={{ padding: 0 }} aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide how it’s worked out' : 'How is this worked out?'}
          </button>
        )}
        {onPayUpi && (
          <button type="button" className="link-quiet" style={{ padding: 0 }} onClick={onPayUpi}>
            Pay by UPI instead
          </button>
        )}
      </div>
      {open && (
        <p className="t-sm t-muted" style={{ marginTop: 8 }}>
          The trip costs the car {money(ride.costTotal ?? 0)}
          {ride.costSummary ? ` (${ride.costSummary})` : ''}, shared equally by the km each person rides, the driver included. No platform fee.
        </p>
      )}
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
