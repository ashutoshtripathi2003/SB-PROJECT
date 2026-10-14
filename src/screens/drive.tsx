import { AnimatePresence, motion } from 'framer-motion'
import { Banknote, CarFront, Check, CircleCheck, Flag, Info, KeyRound, LocateFixed, Navigation, MapPinOff, MessageCircle, Music, Phone, Play, Plus, Share2, Snowflake, Star, UserMinus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { MatchScore } from '@/components/MatchScore'
import { MapView, type MapMarker } from '@/components/MapView'
import { ConfirmDialog, ModalSheet } from '@/components/Sheet'
import { StateView } from '@/components/States'
import { Stops } from '@/components/Stops'
import { BackButton } from '@/components/TopBar'
import { TripForm, validateTrip, type TripDraft } from '@/components/TripForm'
import { etaBubble, useTripEta } from '@/components/TripTime'
import { useCelebrate } from '@/components/Celebrate'
import { useToast } from '@/components/Toast'
import { VehicleForm } from '@/components/VehicleForm'
import { PinEntrySheet, WomenOnlyTag } from '@/components/Safety'
import { Avatar, Badge, Button, Chip, IconButton, Notice, Plate, Rating, RideCardSkeleton, Seats, Segmented, Switch, VerifiedBadge } from '@/components/ui'
import { CAMPUS } from '@/data/places'
import { useIsDesktop } from '@/hooks'
import { dayTime, duration, firstName, km as fmtKm, money, plural, relative, time } from '@/lib/format'
import { driverShare } from '@/lib/fare'
import { haversineKm } from '@/lib/geo'
import { PREFERENCE_LABEL, tierFor } from '@/lib/matching'
import type { Booking, DriverLocation, RidePreference, RiderInfo, RiderLocation } from '@/lib/types'
import { MapScreen, useMapPadding } from '@/layouts/MapScreen'
import { ApiError, Q, bookings, costPreview, rides, routePreview, saveVehicle, useMe, useQuery, useRiderLocations, type CostPreview, type RideDetail, type RouteInfo } from '@/services/api'
import { defaultQuery } from '@/state/search'
import { PREF_OPTIONS } from './find'
import { shareLink } from './rideDetails'
import { FREE_WAIT_S, mmss, useWaited } from '@/components/RiderLive'
import { Reliability } from '@/components/AiHints'
import { paymentLabel } from './trip'

const DRIVER_PREFS: { value: RidePreference; icon: React.ReactNode }[] = [...PREF_OPTIONS.filter((p) => p.value !== 'minimal_detour'), { value: 'ac', icon: <Snowflake /> }, { value: 'music_ok', icon: <Music /> }]

/* ==========================================================================
   Offer a Ride
   ========================================================================== */

export function OfferRide() {
  const { user } = useMe()
  const u = user!
  const nav = useNavigate()
  const celebrate = useCelebrate()
  const loc = useLocation()
  const desktop = useIsDesktop()
  const padding = useMapPadding(0.62)
  const incoming = (loc.state as { draft?: TripDraft } | null)?.draft
  const base = defaultQuery(CAMPUS)
  const maxSeats = u.vehicle?.seats ?? 4
  const [draft, setDraft] = useState<TripDraft>(incoming ? { ...incoming, seats: Math.min(Math.max(incoming.seats, 1), maxSeats) } : { pickup: base.pickup, drop: null, date: base.date, time: base.time, seats: Math.min(3, maxSeats) })
  const [detour, setDetour] = useState<'1' | '2' | '3' | '5'>('3')
  const [prefs, setPrefs] = useState<RidePreference[]>(u.preferences.filter((p) => p !== 'minimal_detour'))
  const [womenOnly, setWomenOnly] = useState(false)
  const [note, setNote] = useState('')
  const [route, setRoute] = useState<RouteInfo | null>(null)
  const [cost, setCost] = useState<CostPreview | null>(null)
  const [errors, setErrors] = useState<ReturnType<typeof validateTrip> & { form?: string | null }>({})
  const [publishing, setPublishing] = useState(false)
  const [vehicleOpen, setVehicleOpen] = useState(false)

  useEffect(() => {
    setRoute(null)
    if (!draft.pickup || !draft.drop || draft.pickup.id === draft.drop.id) return
    let alive = true
    routePreview(draft.pickup, draft.drop)
      .then((r) => alive && setRoute(r))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [draft.pickup, draft.drop])

  // Fair fares: the trip's real cost with this car and the traffic forecast for the chosen time.
  const vehicleKey = JSON.stringify(u.vehicle ?? null)
  useEffect(() => {
    setCost(null)
    if (!u.vehicle || !draft.pickup || !draft.drop || draft.pickup.id === draft.drop.id) return
    const at = new Date(`${draft.date}T${draft.time}:00`)
    if (Number.isNaN(at.getTime())) return
    let alive = true
    costPreview({ origin: draft.pickup, destination: draft.drop, departAt: at.toISOString(), seats: draft.seats })
      .then((c) => alive && setCost(c))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [draft.pickup, draft.drop, draft.date, draft.time, draft.seats, vehicleKey])

  if (u.commute === 'rider' && !u.vehicle) {
    return (
      <div className="page" style={{ justifyContent: 'center' }}>
        <StateView
          icon={<CarFront />}
          title="Offer rides to VIT students"
          body="Add your car to share empty seats on trips you’re already taking and split the fuel cost."
          actions={
            <Button block onClick={() => setVehicleOpen(true)}>
              Add my car
            </Button>
          }
        />
        <VehicleModal open={vehicleOpen} onClose={() => setVehicleOpen(false)} />
      </div>
    )
  }

  async function publish() {
    const errs = validateTrip(draft)
    setErrors(errs)
    if (Object.values(errs).some(Boolean)) return
    if (!u.vehicle) return setVehicleOpen(true)
    setPublishing(true)
    try {
      const ride = await rides.publish({
        origin: draft.pickup!,
        destination: draft.drop!,
        departAt: new Date(`${draft.date}T${draft.time}:00`).toISOString(),
        seats: draft.seats,
        maxDetourKm: Number(detour),
        preferences: prefs,
        note: note.trim() || undefined,
        womenOnly: u.gender === 'female' && womenOnly,
      })
      celebrate({ kind: 'published', title: 'Ride offered successfully', body: 'VIT students heading your way can see it and request a seat now. We’ll notify you the moment someone does.' })
      nav(`/drive/${ride.id}`, { replace: true })
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.field === 'time' ? { time: e.message } : e.field === 'drop' ? { drop: e.message } : { form: e.message })
    } finally {
      setPublishing(false)
    }
  }

  const markers: MapMarker[] = [
    ...(draft.pickup ? [{ id: 'p', at: draft.pickup, kind: 'pickup' as const, label: draft.pickup.name }] : []),
    ...(draft.drop ? [{ id: 'd', at: draft.drop, kind: 'drop' as const, label: draft.drop.name }] : []),
  ]

  return (
    <MapScreen
      snaps={[0.62, 0.92]}
      map={<MapView markers={markers} routes={route ? [{ id: 'offer', coords: route.coords, kind: 'primary', traffic: route.segments }] : []} fit={route ? route.coords.filter((_, i) => i % 10 === 0).concat(markers.map((m) => m.at)) : markers.map((m) => m.at)} padding={padding} />}
      top={<BackButton surface />}
      header={
        <div className="row gap-2 grow" style={{ paddingBottom: 8 }}>
          {desktop && <BackButton />}
          <div className="stack gap-1">
            <h1 className="t-h2">Offer a Ride</h1>
            <p className="t-sm t-muted">Share your empty seats with VIT students.</p>
          </div>
        </div>
      }
      footer={
        <div className="stack gap-2">
          {errors.form && <Notice tone="error">{errors.form}</Notice>}
          <Button size="lg" block loading={publishing} onClick={publish}>
            Publish Ride
          </Button>
        </div>
      }
    >
      <div className="stack gap-6">
        <TripForm value={draft} onChange={(v) => { setDraft(v); setErrors({}) }} seatsLabel="Seats offered" maxSeats={maxSeats} errors={errors} />
        {route && (
          <p className="t-sm t-muted row gap-2" style={{ marginTop: -12 }}>
            <Info size={15} />
            {Math.round(route.distanceKm)} km · about {duration(route.durationMin)}
            {route.traffic && route.traffic !== 'light' ? ` · +${route.trafficDelayMin} min traffic` : route.traffic ? ' · light traffic' : ''}
            {route.source === 'estimate' && ' (estimated)'}
          </p>
        )}

        <section className="stack gap-3">
          <div className="stack gap-1">
            <h2 className="section__title" style={{ padding: 0 }}>
              Trip cost, shared equally
            </h2>
            <span className="t-sm t-muted">You don’t set a price. Everyone in the car, you included, pays an equal share of the trip’s cost, worked out from its distance and its time in traffic.</span>
          </div>
          {cost ? (
            <div className="fare-box">
              <div className="row row--between">
                <span className="stack">
                  <span className="t-sm t-muted">This trip costs about</span>
                  <span className="t-display tabular">{money(cost.cost.total)}</span>
                </span>
                <span className="stack" style={{ alignItems: 'flex-end' }}>
                  <span className="t-sm t-muted">{cost.cost.km} km × {money(cost.cost.perKm)}</span>
                  <span className="t-sm t-muted">+ {cost.cost.min} min × {money(cost.cost.perMin)}</span>
                </span>
              </div>
              <div className="cost-shares" aria-label="What each rider pays">
                {cost.shares.map((s) => (
                  <span key={s.riders} className="cost-shares__item">
                    <span className="t-body t-strong tabular">{money(s.each)}</span>
                    <span className="t-caption t-muted">each with {plural(s.riders, 'rider')}</span>
                    <span className="t-caption t-muted">you pay {money(s.driver)}</span>
                  </span>
                ))}
              </div>
              <p className="cost-working">
                {cost.cost.summary}. Riders book at these prices, which include a 10% cushion so a worse jam on the day doesn’t cost you. When you start, RideSync checks the live traffic: if the real cost is lower, their prices drop. They never go up.
                {cost.trafficDelayMin > 0 && ` Forecast for this time: +${cost.trafficDelayMin} min traffic.`}
              </p>
            </div>
          ) : (
            <p className="t-sm t-muted">{u.vehicle ? 'Choose your destination and time to see the trip cost.' : 'Add your car to see the trip cost.'}</p>
          )}
        </section>

        <section className="stack gap-3">
          <h2 className="section__title" style={{ padding: 0 }}>
            Vehicle
          </h2>
          {u.vehicle ? (
            <div className="vehicle-row">
              <span className="list-row__icon">
                <CarFront />
              </span>
              <span className="stack grow">
                <span className="t-body t-strong">
                  {u.vehicle.make} {u.vehicle.model}
                </span>
                <span className="t-sm t-muted">
                  {u.vehicle.color} · {plural(u.vehicle.seats, 'passenger seat')}
                </span>
              </span>
              <Plate>{u.vehicle.plate}</Plate>
            </div>
          ) : (
            <Button variant="secondary" block icon={<Plus />} onClick={() => setVehicleOpen(true)}>
              Add your car
            </Button>
          )}
          {!u.upiId && (
            <Notice tone="info" icon={<Banknote />} action={<Button size="sm" variant="tonal" onClick={() => nav('/profile/payments')}>Add</Button>}>
              Add your UPI ID so riders can pay you directly. Otherwise they’ll pay cash.
            </Notice>
          )}
        </section>

        <section className="stack gap-3">
          <div className="stack gap-1">
            <h2 className="section__title" style={{ padding: 0 }}>
              Maximum detour
            </h2>
            <span className="t-sm t-muted">How far you’ll go off your route to pick someone up.</span>
          </div>
          <Segmented
            label="Maximum detour"
            value={detour}
            onChange={setDetour}
            options={[
              { value: '1', label: '1 km' },
              { value: '2', label: '2 km' },
              { value: '3', label: '3 km' },
              { value: '5', label: '5 km' },
            ]}
          />
        </section>

        <section className="stack gap-3">
          <h2 className="section__title" style={{ padding: 0 }}>
            Preferences
          </h2>
          <div className="row wrap gap-2">
            {DRIVER_PREFS.map((o) => (
              <Chip key={o.value} icon={o.icon} selected={prefs.includes(o.value)} onClick={() => setPrefs((l) => (l.includes(o.value) ? l.filter((x) => x !== o.value) : [...l, o.value]))}>
                {PREFERENCE_LABEL[o.value]}
              </Chip>
            ))}
          </div>
          {u.gender === 'female' && (
            <label className="row gap-3 women-toggle">
              <span className="stack grow" style={{ minWidth: 0 }}>
                <span className="t-body t-strong">Women-only ride</span>
                <span className="t-sm t-muted">Only female VIT students can see and book it</span>
              </span>
              <Switch checked={womenOnly} onChange={setWomenOnly} label="Women-only ride" />
            </label>
          )}
        </section>

        <section className="field">
          <label className="field__label" htmlFor="ride-note">
            Note for riders (optional)
          </label>
          <div className="input-wrap">
            <textarea id="ride-note" className="input" rows={2} maxLength={200} placeholder="e.g. Leaving from main gate, can drop near Dadar" value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 72 }} />
          </div>
        </section>
      </div>
      <VehicleModal open={vehicleOpen} onClose={() => setVehicleOpen(false)} />
    </MapScreen>
  )
}

function VehicleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const { user } = useMe()
  return (
    <ModalSheet open={open} onClose={onClose} title={user?.vehicle ? 'Your car' : 'Add your car'}>
      <VehicleForm
        initial={user?.vehicle}
        submitLabel="Save car"
        onSubmit={async (v) => {
          await saveVehicle(v)
          onClose()
          toast({ tone: 'success', message: 'Car saved' })
        }}
      />
    </ModalSheet>
  )
}

/* ==========================================================================
   Live location sharing (driver's phone → riders)
   ========================================================================== */

function useShareLocation(rideId: string, active: boolean) {
  const [pos, setPos] = useState<DriverLocation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const last = useRef(0)
  useEffect(() => {
    if (!active) return
    if (!('geolocation' in navigator)) {
      setError('This device can’t share location.')
      return
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const loc = { lat: p.coords.latitude, lng: p.coords.longitude, heading: p.coords.heading ?? undefined, at: new Date().toISOString() }
        setPos(loc)
        setError(null)
        if (Date.now() - last.current > 4000) {
          last.current = Date.now()
          rides.location(rideId, loc.lat, loc.lng, Number.isFinite(p.coords.heading) ? p.coords.heading : null).catch(() => {})
        }
      },
      (e) => setError(e.code === e.PERMISSION_DENIED ? 'Location is blocked. Allow it in your browser so riders can see where you are.' : 'Waiting for GPS…'),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20_000 },
    )
    // Keep the screen awake while driving, where supported.
    let lock: { release: () => Promise<void> } | null = null
    const wake = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
    wake
      ?.request('screen')
      .then((l) => (lock = l))
      .catch(() => {})
    return () => {
      navigator.geolocation.clearWatch(id)
      void lock?.release()
    }
  }, [rideId, active])
  return { pos, error }
}

/* ==========================================================================
   Driver — active ride & requests
   ========================================================================== */

type RiderBooking = Booking & { rider: RiderInfo; noShowRisk?: number }

export function DriverRide() {
  const { rideId } = useParams()
  const { user } = useMe()
  const nav = useNavigate()
  const toast = useToast()
  const celebrate = useCelebrate()
  const desktop = useIsDesktop()
  const padding = useMapPadding(0.5)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'start' | 'complete' | 'cancel' | null>(null)
  const [removing, setRemoving] = useState<RiderBooking | null>(null)
  const q = useQuery<RideDetail>(rideId ? Q.ride(rideId) : null)
  const ride = q.data?.ride
  const live = ride?.status === 'in_progress'
  const { pos, error: locError } = useShareLocation(rideId ?? '', !!live && ride?.driverId === user?.id)
  // Riders waiting for pickup share their phone's live location (Uber/Ola style).
  const riderLocs = useRiderLocations(rideId, Object.fromEntries((q.data?.bookings ?? []).map((b) => [b.id, b.riderLocation])))
  const eta = useTripEta({
    from: pos ?? ride?.origin ?? CAMPUS,
    to: ride?.destination ?? CAMPUS,
    departAt: ride?.departAt ?? new Date().toISOString(),
    plannedMin: ride?.durationMin ?? 0,
    distanceKm: ride?.distanceKm ?? 0,
    live: !!live,
  })

  if (q.loading)
    return (
      <div className="page">
        <div className="page__content page__content--narrow" style={{ paddingTop: 40 }}>
          <RideCardSkeleton />
        </div>
      </div>
    )
  if (!ride || !q.data) return <Navigate to="/rides" replace />
  if (ride.driverId !== user?.id) return <Navigate to={`/ride/${ride.id}`} replace />

  const reqs = (q.data.bookings ?? []) as RiderBooking[]
  const pending = reqs.filter((b) => b.status === 'pending').sort((a, b) => b.matchScore - a.matchScore)
  const riders = reqs.filter((b) => ['accepted', 'confirmed', 'driver_arriving', 'driver_arrived', 'in_progress', 'completed'].includes(b.status))
  const declined = reqs.filter((b) => b.status === 'rejected').length
  const ready = reqs.filter((b) => b.status === 'confirmed' || b.status === 'accepted').length
  const toCollect = riders.filter((b) => b.status !== 'completed').reduce((s, b) => s + b.fare, 0)
  const earned = riders.filter((b) => b.status === 'completed').reduce((s, b) => s + b.fare, 0)
  const statusBadge =
    ride.status === 'scheduled' ? <Badge tone="verified">Active Ride</Badge> : ride.status === 'in_progress' ? <Badge tone="success">Live</Badge> : ride.status === 'completed' ? <Badge>Completed</Badge> : <Badge tone="error">Cancelled</Badge>

  async function act(id: string, fn: () => Promise<unknown>, ok?: string, after?: () => void) {
    setBusy(id)
    try {
      await fn()
      if (ok) toast({ tone: 'success', message: ok })
      after?.()
    } catch (e) {
      toast({ tone: 'error', message: e instanceof ApiError ? e.message : 'Something went wrong' })
    } finally {
      setBusy(null)
    }
  }

  async function runConfirm() {
    setBusy('confirm')
    try {
      if (confirm === 'start') {
        await rides.start(ride!.id)
        celebrate({ kind: 'started', title: 'Ride started', body: 'Your riders can see you on the map now. Drive safe!' })
      }
      if (confirm === 'complete') {
        await rides.complete(ride!.id)
        celebrate({ kind: 'completed', title: 'Ride completed', body: 'Thanks for driving the VIT community!' })
      }
      if (confirm === 'cancel') {
        await rides.cancel(ride!.id, 'Driver’s plans changed')
        celebrate({ kind: 'cancelled', title: 'Ride cancelled', body: 'Your riders have been notified and any online payments are refunded.' })
      }
      setConfirm(null)
    } catch (e) {
      toast({ tone: 'error', message: e instanceof ApiError ? e.message : 'Something went wrong' })
    } finally {
      setBusy(null)
    }
  }

  const upcoming = ride.status === 'scheduled' || live
  // While the trip is upcoming or under way, show today's live route coloured by traffic (like Google Maps).
  const liveRoute = upcoming && eta.coords && eta.coords.length > 1 ? { coords: eta.coords, traffic: eta.segments } : null
  const bubble = upcoming ? etaBubble(liveRoute?.coords ?? ride.route, eta) : null
  const markers: MapMarker[] = [
    { id: 'o', at: ride.origin, kind: 'pickup', label: ride.origin.name, sublabel: `Leave ${time(ride.departAt)}`, darkLabel: true },
    { id: 'd', at: ride.destination, kind: 'drop', label: ride.destination.name, sublabel: upcoming ? `Arrive ~${time(eta.arrive)}` : undefined },
    ...(bubble ? [bubble] : []),
    ...[...pending, ...riders]
      .filter((b) => b.status !== 'completed' && b.status !== 'in_progress' && (riderLocs[b.id] || Math.abs(b.pickup.lat - ride.origin.lat) + Math.abs(b.pickup.lng - ride.origin.lng) > 0.002))
      .map((b) => {
        const l = riderLocs[b.id]
        return l
          ? { id: b.id, at: l, kind: 'me' as const, label: firstName(b.rider.name), sublabel: `Live · ${relative(l.at).toLowerCase()}`, darkLabel: true }
          : { id: b.id, at: b.pickup, kind: 'me' as const, label: firstName(b.rider.name) }
      }),
    ...(pos ? [{ id: 'car', at: pos, kind: 'car' as const, heading: pos.heading }] : []),
  ]

  const footer =
    ride.status === 'scheduled' ? (
      <div className="row gap-2">
        <Button variant="danger-ghost" onClick={() => setConfirm('cancel')}>
          Cancel ride
        </Button>
        <Button block icon={<Play />} disabled={ready === 0} onClick={() => setConfirm('start')} title={ready === 0 ? 'Available once a rider is confirmed' : undefined}>
          Start ride
        </Button>
      </div>
    ) : ride.status === 'in_progress' ? (
      <Button size="lg" block icon={<Flag />} onClick={() => setConfirm('complete')}>
        Complete ride
      </Button>
    ) : (
      <Button size="lg" block variant="secondary" onClick={() => nav('/rides')}>
        Back to My Rides
      </Button>
    )

  return (
    <MapScreen
      snaps={[0.5, 0.92]}
      map={<MapView routes={[liveRoute ? { id: `${ride.id}-live`, ...liveRoute } : { id: ride.id, coords: ride.route }]} markers={markers} fit={pos ? [pos, ride.destination] : [ride.origin, ride.destination]} padding={padding} follow={pos ? 'car' : undefined} />}
      top={
        <>
          <BackButton surface to="/rides" />
          <span className="grow" />
          <IconButton
            label="Share ride"
            surface
            onClick={async () => {
              const r = await shareLink('Ride on RideSync', `I’m driving ${ride.origin.name} → ${ride.destination.name} at ${time(ride.departAt)}. Book a seat on RideSync:`, `${window.location.origin}/ride/${ride.id}`)
              if (r === 'copied') toast({ tone: 'success', message: 'Link copied' })
            }}
          >
            <Share2 />
          </IconButton>
        </>
      }
      header={desktop ? <><BackButton to="/rides" /><span className="grow t-h3">Your ride</span></> : undefined}
      footer={footer}
    >
      <div className="stack gap-5">
        <div className="stack gap-3">
          <div className="row row--between">
            <span className="row gap-2">
              {statusBadge}
              {ride.womenOnly && <WomenOnlyTag />}
            </span>
            <span className="t-sm t-muted">{dayTime(ride.departAt)}</span>
          </div>
          <Stops
            from={{ title: ride.origin.name, subtitle: ride.origin.area, time: time(ride.departAt) }}
            to={{ title: ride.destination.name, subtitle: ride.destination.area, time: upcoming ? `~${time(eta.arrive)}` : time(new Date(new Date(ride.departAt).getTime() + ride.durationMin * 60_000)) }}
          />
          <div className="facts">
            <div className="fact">
              <span className="fact__label">Seats filled</span>
              <span className="fact__value row gap-2">
                {ride.seatsBooked}/{ride.seatsTotal} <Seats total={ride.seatsTotal} taken={ride.seatsBooked} />
              </span>
            </div>
            <div className="fact">
              <span className="fact__label">{ride.fareMode === 'share' ? 'Trip cost' : 'Per seat'}</span>
              <span className="fact__value" title={ride.costSummary}>{ride.fareMode === 'share' ? money(ride.costTotal ?? 0) : ride.farePerSeat ? money(ride.farePerSeat) : 'Free'}</span>
            </div>
            <div className="fact">
              <span className="fact__label">{ride.status === 'completed' ? 'Cost share' : 'To collect'}</span>
              <span className="fact__value">{money(ride.status === 'completed' ? earned : toCollect)}</span>
            </div>
          </div>
        </div>

        {ride.fareMode === 'share' && ride.costTotal != null && (
          <div className="stack gap-1" style={{ marginTop: -8 }}>
            <p className="t-body">
              <span className="t-strong">Your share {money(driverShare(ride.costTotal, riders.reduce((s, b) => s + b.fare, 0)))}</span>
              <span className="t-muted"> · Riders pay {money(riders.reduce((s, b) => s + b.fare, 0))} · Trip cost {money(ride.costTotal)}</span>
            </p>
            <p className="t-sm t-muted">
              {ride.costSummary}. Split equally by the km each person rides, you included: you pay your share yourself.
              {ride.status === 'scheduled' && ' Fixed with the live traffic when you start the trip.'}
            </p>
          </div>
        )}

        {live && (
          <Notice tone={locError ? 'warning' : 'success'} icon={locError ? <MapPinOff /> : <LocateFixed />} title={locError ? 'Location not shared' : 'Sharing live location'}>
            {locError ?? 'Riders can see where you are. Keep this screen open while you drive.'}
          </Notice>
        )}

        {ride.status === 'scheduled' && (
          <section className="stack gap-3">
            <div className="row row--between">
              <h2 className="section__title" style={{ padding: 0 }}>
                Requests received
              </h2>
              {pending.length > 0 && <span className="t-sm t-muted">{pending.length} pending</span>}
            </div>
            <AnimatePresence initial={false}>
              {pending.map((b) => (
                <motion.div key={b.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -40, height: 0, marginTop: -12 }} transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}>
                  <RequestCard
                    booking={b}
                    busy={busy === b.id}
                    full={ride.seatsTotal - ride.seatsBooked < b.seats}
                    onAccept={() =>
                      act(b.id, () => bookings.respond(b.id, true), undefined, () =>
                        celebrate({ kind: 'accepted', title: 'Ride accepted', body: `${firstName(b.rider.name)} is riding with you. They’ll confirm their seat and pay next.` }),
                      )
                    }
                    onDecline={() => act(b.id, () => bookings.respond(b.id, false))}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
            {pending.length === 0 && (
              <div className="waiting">
                <div className="radar" style={{ width: 64, height: 64 }}>
                  <span className="radar__ring" />
                  <span className="radar__ring" />
                  <CarFront size={22} className="t-primary" />
                </div>
                <div className="stack gap-1">
                  <span className="t-body t-strong">{ride.seatsBooked >= ride.seatsTotal ? 'Your car is full' : 'Waiting for requests'}</span>
                  <span className="t-sm t-muted">{ride.seatsBooked >= ride.seatsTotal ? 'All seats are taken.' : 'Your ride is live in search. Requests appear here instantly.'}</span>
                </div>
              </div>
            )}
          </section>
        )}

        {riders.length > 0 && (
          <section className="stack gap-3">
            <h2 className="section__title" style={{ padding: 0 }}>
              Riders
            </h2>
            {riders.map((b) => (
              <RiderRow
                key={b.id}
                b={b}
                liveAt={riderLocs[b.id]}
                live={!!live}
                done={ride.status === 'completed'}
                busy={busy === b.id}
                onStep={(fn, ok) => act(b.id, fn, ok)}
                onChat={() => nav(`/chat/${b.id}`)}
                onRemove={() => setRemoving(b)}
              />
            ))}
          </section>
        )}

        {declined > 0 && <p className="t-sm t-muted">{plural(declined, 'request')} declined</p>}

        {ride.status === 'completed' && (
          <Notice tone="success" icon={<CircleCheck />} title="Ride completed">
            {money(earned)} cost-share from {plural(riders.filter((b) => b.status === 'completed').length, 'rider')}. Thanks for driving the VIT community.
          </Notice>
        )}
      </div>

      <ConfirmDialog
        open={confirm === 'start'}
        title="Start this ride?"
        body={`Riders will be told you’re on the way and can track your live location.${pending.length ? ` ${plural(pending.length, 'pending request')} will be declined.` : ''}`}
        confirmLabel="Start ride"
        cancelLabel="Not yet"
        loading={busy === 'confirm'}
        onConfirm={runConfirm}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'complete'}
        title="Complete this ride?"
        body={riders.some((b) => ['driver_arriving', 'driver_arrived'].includes(b.status)) ? 'Some riders weren’t marked as picked up — their seats will be cancelled.' : 'Confirm everyone has been dropped off.'}
        confirmLabel="Complete ride"
        cancelLabel="Not yet"
        loading={busy === 'confirm'}
        onConfirm={runConfirm}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        title="Cancel your ride?"
        body={riders.length ? `${plural(riders.length, 'rider')} will be notified. Refund anyone who already paid you by UPI. Frequent cancellations lower your reliability score.` : 'Your ride will be removed from search.'}
        confirmLabel="Cancel ride"
        destructive
        loading={busy === 'confirm'}
        onConfirm={runConfirm}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={!!removing}
        title={`Remove ${removing ? firstName(removing.rider.name) : ''} from this ride?`}
        body={`They’ll be notified and their seat freed.${removing?.paymentStatus !== 'unpaid' ? ' Refund their UPI payment directly.' : ''}`}
        confirmLabel="Remove rider"
        destructive
        loading={busy === removing?.id}
        onConfirm={async () => {
          if (!removing) return
          await act(removing.id, () => bookings.cancel(removing.id, 'Driver removed the booking'))
          setRemoving(null)
        }}
        onClose={() => setRemoving(null)}
      />
    </MapScreen>
  )
}

/** Turn-by-turn directions in Google Maps (opens the Maps app on phones). */
const directionsUrl = (to: { lat: number; lng: number }) => `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}&travelmode=driving`

function RiderRow({ b, liveAt, live, done, busy, onStep, onChat, onRemove }: { b: RiderBooking; liveAt?: RiderLocation; live: boolean; done: boolean; busy: boolean; onStep: (fn: () => Promise<unknown>, ok?: string) => void; onChat: () => void; onRemove: () => void }) {
  const name = firstName(b.rider.name)
  const celebrate = useCelebrate()
  const [pinOpen, setPinOpen] = useState(false)
  const waited = useWaited(b.status === 'driver_arrived' ? b.arrivedAt : undefined)
  const statusBadge =
    b.status === 'accepted' ? (
      <Badge tone="warning">Awaiting payment</Badge>
    ) : b.status === 'driver_arrived' ? (
      <Badge tone="info">Waiting</Badge>
    ) : b.status === 'in_progress' ? (
      <Badge tone="success">In car</Badge>
    ) : b.status === 'completed' ? (
      <Badge icon={<Check />}>Dropped</Badge>
    ) : (
      <Badge tone="success" icon={<Check />}>
        Confirmed
      </Badge>
    )
  return (
    <div className="request-card" style={{ gap: 12 }}>
      <div className="row gap-3">
        <Avatar name={b.rider.name} src={b.rider.photo} size="sm" verified={b.rider.verified} />
        <span className="stack grow" style={{ minWidth: 0 }}>
          <span className="t-body t-strong truncate">{b.rider.name}</span>
          <span className="t-sm t-muted truncate">
            {b.pickup.name} → {b.drop.name}
          </span>
          {b.status === 'driver_arrived' && b.arrivedAt && (
            <span className="t-sm t-strong" style={{ color: waited >= FREE_WAIT_S ? 'var(--error-600)' : 'var(--warning-600)' }}>
              Waiting {mmss(waited)}
              {waited < FREE_WAIT_S ? ` · free wait ends in ${mmss(FREE_WAIT_S - waited)}` : ' · you can mark them as no-show'}
            </span>
          )}
          {liveAt && b.status !== 'in_progress' && (
            <span className="t-sm row gap-1" style={{ color: 'var(--success-600)' }}>
              <LocateFixed style={{ width: 14, height: 14 }} />
              Live location · {fmtKm(haversineKm(liveAt, b.pickup))} from pickup · {relative(liveAt.at).toLowerCase()}
            </span>
          )}
        </span>
        {statusBadge}
      </div>
      <div className="row row--between t-sm">
        <span className="t-muted">
          {money(b.fare)} · {paymentLabel(b)}
          {!!b.settleDue && <span style={{ color: 'var(--warning-600)' }}>{b.settleDue < 0 ? ` · return ${money(-b.settleDue)}` : ` · ${money(b.settleDue)} more to collect`}</span>}
        </span>
        {(b.paymentStatus === 'unpaid' || b.paymentStatus === 'marked_paid') && b.status !== 'accepted' && (
          <button className="t-strong t-primary" disabled={busy} onClick={() => onStep(() => bookings.paymentReceived(b.id), `Marked ${money(b.fare)} as received`)}>
            Mark received
          </button>
        )}
      </div>
      {!done && b.status !== 'completed' && (
        <div className="row gap-2">
          {b.rider.phone && (
            <a className="btn btn--secondary btn--sm" href={`tel:+91${b.rider.phone}`} aria-label={`Call ${name}`}>
              <span className="btn__label">
                <Phone />
              </span>
            </a>
          )}
          <Button size="sm" variant="secondary" icon={<MessageCircle />} onClick={onChat}>
            Chat
          </Button>
          {['accepted', 'confirmed', 'driver_arriving', 'driver_arrived', 'in_progress'].includes(b.status) && (
            <a
              className="btn btn--secondary btn--sm"
              href={directionsUrl(b.status === 'in_progress' ? b.drop : (liveAt ?? b.pickup))}
              target="_blank"
              rel="noreferrer"
              aria-label={b.status === 'in_progress' ? `Navigate to ${name}’s drop` : `Navigate to ${name}’s pickup`}
            >
              <span className="btn__label">
                <Navigation />
                Navigate
              </span>
            </a>
          )}
          <span className="grow" />
          {live && b.status === 'driver_arriving' && (
            <Button size="sm" loading={busy} onClick={() => onStep(() => bookings.arrived(b.id))}>
              I’ve arrived
            </Button>
          )}
          {live && b.status === 'driver_arrived' && waited >= FREE_WAIT_S && (
            <Button size="sm" variant="danger-ghost" loading={busy} onClick={() => onStep(() => bookings.noShow(b.id), `${name} marked as no-show`)}>
              Didn’t come
            </Button>
          )}
          {live && b.status === 'driver_arrived' && (
            <Button size="sm" loading={busy} icon={<KeyRound />} onClick={() => setPinOpen(true)}>
              Enter PIN
            </Button>
          )}
          {live && b.status === 'in_progress' && (
            <Button size="sm" loading={busy} onClick={() => onStep(() => bookings.dropped(b.id), `${name} dropped off`)}>
              Dropped off
            </Button>
          )}
          {!live && ['accepted', 'confirmed'].includes(b.status) && (
            <Button size="sm" variant="ghost" icon={<UserMinus />} onClick={onRemove}>
              Remove
            </Button>
          )}
        </div>
      )}
      {b.status === 'completed' && !b.driverRating && (
        <div className="row gap-2">
          <span className="t-sm t-muted grow">Rate {name}</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className="star-btn" style={{ width: 32, height: 32 }} aria-label={`${n} stars`} disabled={busy} onClick={() => onStep(() => bookings.rate(b.id, n, [], ''), 'Thanks for rating')}>
              <Star style={{ width: 22, height: 22 }} />
            </button>
          ))}
        </div>
      )}
      <PinEntrySheet
        open={pinOpen}
        name={name}
        onClose={() => setPinOpen(false)}
        onVerify={async (pin) => {
          await bookings.pickedUp(b.id, pin)
          setPinOpen(false)
          celebrate({ kind: 'started', title: 'PIN verified', body: `${name} is in the car. Drive safe!` })
        }}
      />
    </div>
  )
}

function RequestCard({ booking, onAccept, onDecline, busy, full }: { booking: RiderBooking; onAccept: () => void; onDecline: () => void; busy: boolean; full: boolean }) {
  const rider = booking.rider
  return (
    <div className="request-card">
      <div className="row gap-3">
        <Avatar name={rider.name} src={rider.photo} verified={rider.verified} />
        <div className="stack grow" style={{ minWidth: 0 }}>
          <span className="t-body t-strong truncate">{rider.name}</span>
          <Rating value={rider.rating} count={rider.ridesTaken} />
        </div>
        <MatchScore score={booking.matchScore} tier={tierFor(booking.matchScore)} label="compatible" />
      </div>
      <div className="row wrap gap-2">
        {rider.verified && <VerifiedBadge />}
        <Reliability risk={booking.noShowRisk} />
        {booking.seats > 1 && <Badge>{plural(booking.seats, 'seat')}</Badge>}
      </div>
      <Stops from={{ title: booking.pickup.name, subtitle: booking.pickup.area }} to={{ title: booking.drop.name }} />
      {booking.message && <p className="request-card__msg">“{booking.message}”</p>}
      <div className="row gap-2">
        <Button variant="secondary" block icon={<X />} disabled={busy} onClick={onDecline}>
          Decline
        </Button>
        <Button block icon={<Check />} loading={busy} disabled={full} onClick={onAccept}>
          {full ? 'Car full' : `Accept · ${money(booking.fare)}`}
        </Button>
      </div>
    </div>
  )
}
