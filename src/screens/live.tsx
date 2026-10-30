import { AnimatePresence, motion } from 'framer-motion'
import { MessageCircle, Phone, Share2, ShieldAlert, Siren, Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { MapView, type MapMarker } from '@/components/MapView'
import { ModalSheet } from '@/components/Sheet'
import { Stops } from '@/components/Stops'
import { BackButton } from '@/components/TopBar'
import { useCelebrate } from '@/components/Celebrate'
import { useToast } from '@/components/Toast'
import { Avatar, Button, Chip, IconButton, ListRow, Plate, Rating, RideCardSkeleton, cx } from '@/components/ui'
import { useIsDesktop, useNow } from '@/hooks'
import { haversineKm, projectOnPolyline } from '@/lib/geo'
import { firstName, km as fmtKm, money, relative, time } from '@/lib/format'
import type { LatLng } from '@/lib/types'
import { MapScreen, useMapPadding } from '@/layouts/MapScreen'
import { ApiError, Q, bookings, liveEta, useDriverLocation, useMe, useQuery, type BookingDetail, type LiveEta } from '@/services/api'
import { RidePinCard, useShareTrip } from '@/components/Safety'
import { FREE_WAIT_S, RiderLiveBar, mmss, useShareRiderLocation, useWaited } from '@/components/RiderLive'
import { paymentLabel, SuccessMark } from './trip'

// Configure per campus before launch; hidden when not set so we never show an unverified number.
const CAMPUS_SECURITY = import.meta.env.VITE_CAMPUS_SECURITY_PHONE as string | undefined
const RATING_TAGS = ['Safe driving', 'Friendly', 'On time', 'Clean vehicle', 'Smooth ride']

const etaMin = (from: LatLng, to: LatLng) => Math.max(1, Math.round(((haversineKm(from, to) * 1.35) / 22) * 60))

/**
 * Traffic-aware ETA from the server, refreshed when the car has moved ~300 m or every 90 s.
 * Until it arrives (or if routing is down) a straight-line estimate is used.
 */
function useLiveEta(from: LatLng | null, to: LatLng | null) {
  const [eta, setEta] = useState<(LiveEta & { from: LatLng; at: number; to: LatLng }) | null>(null)
  const busy = useRef(false)
  const now = Date.now()
  const fresh = eta && to && eta.to.lat === to.lat && eta.to.lng === to.lng
  const due = !!from && !!to && (!fresh || haversineKm(eta.from, from) > 0.3 || now - eta.at > 90_000)
  useEffect(() => {
    if (!due || !from || !to || busy.current) return
    busy.current = true
    liveEta(from, to, { route: true })
      .then((r) => setEta({ ...r, from, to, at: Date.now() }))
      .catch(() => {})
      .finally(() => {
        busy.current = false
      })
  }, [due, from, to])
  if (!from || !to) return null
  if (!fresh) return { minutes: etaMin(from, to), traffic: null as LiveEta['traffic'], delay: 0, coords: undefined, segments: undefined }
  // Subtract the distance covered since the last check so the number keeps ticking down.
  const covered = Math.round(((haversineKm(eta.from, from) * 1.2) / 22) * 60)
  return { minutes: Math.max(1, eta.durationMin - covered), traffic: eta.traffic, delay: eta.trafficDelayMin, coords: eta.coords, segments: eta.segments }
}

export function LiveRide() {
  const { bookingId } = useParams()
  const { user } = useMe()
  const nav = useNavigate()
  const desktop = useIsDesktop()
  const padding = useMapPadding(0.46)
  const [sos, setSos] = useState(false)
  const q = useQuery<BookingDetail>(bookingId ? Q.booking(bookingId) : null)
  const loc = useDriverLocation(q.data?.ride.id, q.data?.ride.driverLocation)
  useNow(15_000)
  const live = q.data && ['driver_arriving', 'in_progress'].includes(q.data.booking.status) ? (q.data.booking.status === 'in_progress' ? q.data.booking.drop : q.data.booking.pickup) : null
  const etaInfo = useLiveEta(loc ?? null, live)
  const shareTrip = useShareTrip(bookingId ?? '')
  const waited = useWaited(q.data?.booking.status === 'driver_arrived' ? q.data.booking.arrivedAt : undefined)
  const shareMe = useShareRiderLocation(bookingId ?? '', !!q.data && q.data.role === 'rider' && ['driver_arriving', 'driver_arrived'].includes(q.data.booking.status))

  if (q.loading)
    return (
      <div className="page">
        <div className="page__content page__content--narrow" style={{ paddingTop: 40 }}>
          <RideCardSkeleton />
        </div>
      </div>
    )
  const d = q.data
  if (!d) return <Navigate to="/rides" replace />
  if (d.role === 'driver') return <Navigate to={`/drive/${d.ride.id}`} replace />
  const { booking, ride, driver, vehicle: v } = d
  if (booking.status === 'completed') return <RateTrip detail={d} />
  if (!['driver_arriving', 'driver_arrived', 'in_progress'].includes(booking.status)) return <Navigate to={`/trip/${booking.id}`} replace />

  const name = firstName(driver.name)
  const target = booking.status === 'in_progress' ? booking.drop : booking.pickup
  const eta = etaInfo?.minutes ?? null
  const stale = loc ? Date.now() - new Date(loc.at).getTime() > 2 * 60_000 : false

  let progress = 0
  if (loc && ride.route.length > 1) {
    const at = projectOnPolyline(loc, ride.route).alongKm
    const p = projectOnPolyline(booking.pickup, ride.route).alongKm
    const dr = projectOnPolyline(booking.drop, ride.route).alongKm
    progress = booking.status === 'in_progress' ? (at - p) / Math.max(dr - p, 0.1) : p > 0.2 ? at / p : 0.5
    progress = Math.max(0.03, Math.min(1, progress))
  }

  const headline =
    booking.status === 'driver_arriving'
      ? { title: eta ? `Arriving in ${eta} min` : `${name} is on the way`, sub: loc ? `${name} is heading to ${booking.pickup.name}` : `Waiting for ${name}’s live location…` }
      : booking.status === 'driver_arrived'
        ? {
            title: `${name} has arrived`,
            sub:
              waited < FREE_WAIT_S
                ? `Waiting ${mmss(waited)} · please reach within ${mmss(FREE_WAIT_S - waited)}. Look for a ${v.color.toLowerCase()} ${v.model} · ${v.plate}`
                : `${name} has waited ${mmss(waited)} — hurry, or call so they don’t leave. ${v.color} ${v.model} · ${v.plate}`,
          }
        : { title: eta ? `${eta} min to ${booking.drop.name}` : `On the way to ${booking.drop.name}`, sub: 'Enjoy the ride. Share your trip with someone you trust.' }


  const markers: MapMarker[] = [
    { id: 'pick', at: booking.pickup, kind: 'pickup', label: booking.status === 'in_progress' ? undefined : 'Pickup', sublabel: booking.status === 'driver_arriving' && eta ? `${name} in ${eta} min` : undefined, darkLabel: true },
    { id: 'drop', at: booking.drop, kind: 'drop', label: booking.drop.name, sublabel: booking.status === 'in_progress' && eta ? `Arrive ~${time(new Date(Date.now() + eta * 60_000))}` : undefined },
    ...(loc && eta && etaInfo?.traffic && booking.status !== 'driver_arrived'
      ? [{ id: 'eta', kind: 'eta' as const, at: { lat: (loc.lat + target.lat) / 2, lng: (loc.lng + target.lng) / 2 }, label: `${eta} min`, sublabel: etaInfo.traffic === 'light' ? 'Light traffic' : `+${etaInfo.delay} min traffic`, tone: etaInfo.traffic }]
      : []),
    ...(loc ? [{ id: 'car', at: loc, kind: 'car' as const, heading: loc.heading }] : []),
  ]
  const fit = loc ? [loc, target] : [booking.pickup, booking.drop]
  const contacts = user?.emergencyContacts ?? []
  const smsBody = encodeURIComponent(`SOS from ${user?.name}: I’m in a RideSync carpool with ${driver.name}, ${v.color} ${v.model} ${v.plate}.${loc ? ` Location: https://maps.google.com/?q=${loc.lat},${loc.lng}` : ''}`)

  return (
    <MapScreen
      snaps={[0.46, 0.88]}
      map={
        <MapView
          routes={
            // The road ahead with live traffic colours (blue = clear, orange/red = slow), else the planned route.
            etaInfo?.coords && etaInfo.coords.length > 1 ? [{ id: 'r-live', coords: etaInfo.coords, kind: 'primary', traffic: etaInfo.segments }] : [{ id: 'r', coords: ride.route, kind: 'primary' }]
          }           markers={markers}
          fit={fit}
          padding={padding}
          follow="car"
        />
      }
      top={
        <>
          <BackButton surface to={`/trip/${booking.id}`} />
          <span className="grow" />
          <IconButton label="Share trip" surface onClick={shareTrip.start}>
            <Share2 />
          </IconButton>
        </>
      }
      header={desktop ? <><BackButton to="/home" /><span className="grow t-h3">Your ride</span></> : undefined}
    >
      <div className="stack gap-5">
        <AnimatePresence mode="wait">
          <motion.div key={booking.status} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }} className="stack gap-1">
            <h1 className="t-h1" aria-live="polite">
              {headline.title}
            </h1>
            <p className="t-body t-muted">{headline.sub}</p>
            {eta && etaInfo?.traffic && booking.status !== 'driver_arrived' && (
              <p className="t-sm" style={{ color: etaInfo.traffic === 'heavy' ? 'var(--error-600)' : etaInfo.traffic === 'moderate' ? 'var(--warning-600)' : 'var(--success-600)' }}>
                {etaInfo.traffic === 'light' ? 'Light traffic · live' : `${etaInfo.traffic === 'heavy' ? 'Heavy' : 'Some'} traffic · +${etaInfo.delay} min · live`}
              </p>
            )}
            {stale && loc && <p className="t-sm" style={{ color: 'var(--warning-600)' }}>Location last updated {relative(loc.at).toLowerCase()}</p>}
          </motion.div>
        </AnimatePresence>
        <div className={cx('progress', !loc && 'progress--indeterminate')} aria-hidden>
          <div className="progress__bar" style={loc ? { width: `${booking.status === 'driver_arrived' ? 100 : Math.round(progress * 100)}%`, background: booking.status === 'in_progress' ? 'var(--success-500)' : undefined } : undefined} />
        </div>

        <RiderLiveBar driver={firstName(driver.name)} share={shareMe} />
        {d.ridePin && <RidePinCard pin={d.ridePin} plate={v.plate} />}
        <div className="row gap-3">
          <Avatar name={driver.name} src={driver.photo} size="lg" verified={driver.verified} />
          <div className="stack grow gap-1" style={{ minWidth: 0 }}>
            <span className="t-h3 truncate">{driver.name}</span>
            <Rating value={driver.rating} />
            <span className="t-sm t-muted">
              {v.color} {v.make} {v.model}
            </span>
          </div>
          <Plate>{v.plate}</Plate>
        </div>

        <div className="actions-row">
          {d.driverPhone ? (
            <a className="action-tile" href={`tel:+91${d.driverPhone}`}>
              <Phone />
              Call
            </a>
          ) : (
            <span className="action-tile" style={{ opacity: 0.5 }}>
              <Phone />
              Call
            </span>
          )}
          <button className="action-tile" onClick={() => nav(`/chat/${booking.id}`)}>
            <MessageCircle />
            Chat
          </button>
          <button className="action-tile" onClick={shareTrip.start} disabled={shareTrip.busy}>
            <Share2 />
            Share trip
          </button>
          <button className="action-tile action-tile--danger" onClick={() => setSos(true)}>
            <Siren />
            SOS
          </button>
        </div>

        {shareTrip.sheet}
        <hr className="divider" />
        <Stops from={{ title: booking.pickup.name, subtitle: booking.pickup.area }} to={{ title: booking.drop.name, subtitle: booking.drop.area }} />
        <div className="row row--between t-sm t-muted">
          <span>
            {money(booking.fare)} · {paymentLabel(booking)}
          </span>
          {booking.paymentMethod === 'cash' && booking.paymentStatus === 'unpaid' && (
            <button className="t-strong t-primary" onClick={() => nav(`/pay/${booking.id}`)}>
              Pay now
            </button>
          )}
        </div>
      </div>

      <ModalSheet open={sos} onClose={() => setSos(false)} title={<span className="row gap-2" style={{ color: 'var(--error-600)' }}><ShieldAlert size={20} /> Emergency</span>}>
        <div className="stack gap-2">
          <p className="t-body t-secondary" style={{ marginBottom: 8 }}>
            If you feel unsafe, call emergency services first.
          </p>
          <a href="tel:112" className="btn btn--danger btn--lg btn--block">
            <span className="btn__label">
              <Phone /> Call 112 (Emergency)
            </span>
          </a>
          <div className="list" style={{ marginTop: 8 }}>
            {CAMPUS_SECURITY && <ListRow icon={<ShieldAlert />} title="Call campus security" subtitle={CAMPUS_SECURITY} onClick={() => (window.location.href = `tel:${CAMPUS_SECURITY}`)} />}
            {contacts.length > 0 ? (
              <a className="list-row" href={`sms:${contacts.map((c) => `+91${c.phone}`).join(',')}?body=${smsBody}`}>
                <span className="list-row__icon">
                  <Share2 />
                </span>
                <span className="list-row__body">
                  <span className="list-row__title">Text my emergency contacts</span>
                  <span className="list-row__sub">{contacts.map((c) => c.name).join(', ')} · includes your live location</span>
                </span>
              </a>
            ) : (
              <ListRow icon={<Share2 />} title="Add emergency contacts" subtitle="So you can alert them in one tap" onClick={() => nav('/profile/safety')} />
            )}
          </div>
        </div>
      </ModalSheet>
    </MapScreen>
  )
}

function RateTrip({ detail }: { detail: BookingDetail }) {
  const nav = useNavigate()
  const toast = useToast()
  const celebrate = useCelebrate()
  const { booking, driver } = detail
  const [stars, setStars] = useState(booking.riderRating ?? 0)
  const [tags, setTags] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const rated = !!booking.riderRating

  async function submit() {
    setSaving(true)
    try {
      await bookings.rate(booking.id, stars, tags, comment)
      celebrate({ kind: 'completed', title: 'Thanks for rating!', body: 'Ratings keep RideSync safe and friendly for every VIT student.' })
      nav('/home', { replace: true })
    } catch (e) {
      toast({ tone: 'error', message: e instanceof ApiError ? e.message : 'Couldn’t save rating' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <div className="page__content page__content--narrow" style={{ paddingTop: 40 }}>
        <div className="hero">
          <SuccessMark />
          <h1 className="t-h1">You’ve arrived</h1>
          <p className="t-body t-muted">{booking.drop.name}</p>
        </div>
        <dl className="trip-summary">
          <div>
            <dt>Distance</dt>
            <dd>{fmtKm(haversineKm(booking.pickup, booking.drop) * 1.3)}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{booking.pickedUpAt && booking.droppedAt ? `${Math.max(1, Math.round((+new Date(booking.droppedAt) - +new Date(booking.pickedUpAt)) / 60_000))} min` : '—'}</dd>
          </div>
          <div>
            <dt>Fare</dt>
            <dd>{money(booking.fare)}</dd>
          </div>
          <div>
            <dt>CO₂ saved</dt>
            <dd>{booking.co2Kg ? `~${booking.co2Kg.toFixed(1)} kg` : '—'}</dd>
          </div>
        </dl>
        <div className="stack gap-5" style={{ alignItems: 'center', marginTop: 8 }}>
          <Avatar name={driver.name} src={driver.photo} size="xl" verified={driver.verified} />
          <h2 className="t-h3">{rated ? `You rated ${firstName(driver.name)}` : `How was your ride with ${firstName(driver.name)}?`}</h2>
          <div className="row gap-2" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <motion.button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} whileTap={{ scale: 0.85 }} className={cx('star-btn', n <= stars && 'is-on')} onClick={() => !rated && setStars(n)}>
                <Star />
              </motion.button>
            ))}
          </div>
          {stars > 0 && !rated && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="stack gap-4" style={{ width: '100%' }}>
              <div className="row wrap gap-2" style={{ justifyContent: 'center' }}>
                {RATING_TAGS.map((t) => (
                  <Chip key={t} size="sm" selected={tags.includes(t)} onClick={() => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))}>
                    {t}
                  </Chip>
                ))}
              </div>
              <div className="input-wrap">
                <textarea className="input" placeholder={stars <= 3 ? 'What could have been better?' : 'Anything else? (optional)'} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} style={{ minHeight: 84 }} aria-label="Comment" />
              </div>
            </motion.div>
          )}
        </div>
      </div>
      <div className="page__footer page__footer--narrow">
        {rated ? (
          <Button size="lg" block onClick={() => nav('/home')}>
            Done
          </Button>
        ) : (
          <div className="stack gap-2">
            <Button size="lg" block disabled={!stars} loading={saving} onClick={submit}>
              Submit rating
            </Button>
            <Button variant="ghost" block onClick={() => nav('/home')}>
              Skip
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
