import { ArrowRight, Bell, CarFront, ChevronRight, Search } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { InstallHint } from '@/components/InstallHint'
import { Logo } from '@/components/Logo'
import { MapView, type MapRoute } from '@/components/MapView'
import { TripForm, validateTrip, type TripDraft } from '@/components/TripForm'
import { Avatar, Badge, Button, Rating, Skeleton } from '@/components/ui'
import { CAMPUS } from '@/data/places'
import { dayTime, firstName, money, time } from '@/lib/format'
import type { OfferedItem, SearchQuery, TripItem } from '@/lib/types'
import { MAX_SEATS } from '@/lib/validation'
import { MapScreen, useMapPadding } from '@/layouts/MapScreen'
import { LIVE_STATUSES, Q, useMe, useQuery, type Badges, type FeedItem, type Trips } from '@/services/api'
import { defaultQuery, useSearch } from '@/state/search'
import { BOOKING_STATUS } from './trip'

const ACTIVE = ['pending', 'accepted', 'confirmed', 'driver_arriving', 'driver_arrived', 'in_progress']

export function Home() {
  const { user } = useMe()
  const u = user!
  const nav = useNavigate()
  const search = useSearch()
  const trips = useQuery<Trips>(Q.trips)
  const feed = useQuery<FeedItem[]>(Q.feed)
  const unread = useQuery<Badges>(Q.badges).data?.unread ?? 0
  const canDrive = u.commute !== 'rider'
  // Drivers-only start in "offer"; everyone else finds a ride, with "Offer a ride" one tap away.
  const mode: 'find' | 'offer' = u.commute === 'driver' ? 'offer' : 'find'
  const base = search.query ?? defaultQuery(CAMPUS)
  const [draft, setDraft] = useState<TripDraft>({ pickup: base.pickup, drop: search.query ? base.drop : null, date: base.date, time: base.time, seats: base.seats })
  const [errors, setErrors] = useState<ReturnType<typeof validateTrip>>({})
  const padding = useMapPadding(0.6)

  const booking = trips.data?.bookings
    .filter((b) => ACTIVE.includes(b.status))
    .sort((a, b) => +new Date(a.ride.departAt) - +new Date(b.ride.departAt))[0]
  const offered = trips.data?.rides.filter((r) => r.status === 'scheduled' || r.status === 'in_progress').sort((a, b) => +new Date(a.departAt) - +new Date(b.departAt))[0]
  const soon = feed.data ?? []

  const routes: MapRoute[] = soon.slice(0, 5).map((f) => ({ id: f.ride.id, coords: f.ride.route, kind: 'alt' }))
  const fit = [CAMPUS, ...soon.slice(0, 5).flatMap((f) => [f.ride.origin, f.ride.destination])]

  function submit(as: 'find' | 'offer' = mode) {
    const errs = validateTrip(draft)
    setErrors(errs)
    if (Object.values(errs).some(Boolean)) return
    if (as === 'offer') {
      nav('/offer', { state: { draft } })
      return
    }
    const q: SearchQuery = { pickup: draft.pickup!, drop: draft.drop!, date: draft.date, time: draft.time, seats: draft.seats, preferences: search.query?.preferences ?? u.preferences.filter((p) => p !== 'music_ok' && p !== 'ac') }
    void search.run(q)
    nav('/find/results')
  }

  const h = new Date().getHours()
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <MapScreen
      snaps={[0.6, 0.92]}
      map={<MapView routes={routes} markers={[{ id: 'campus', at: CAMPUS, kind: 'pickup', label: CAMPUS.name, darkLabel: true }]} fit={fit} padding={padding} animateRoutes={false} center={CAMPUS} />}
      top={
        <div className="row row--between grow">
          <span className="map-chip">
            <Logo height={22} />
          </span>
          <Link to="/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} className="icon-btn icon-btn--surface" style={{ position: 'relative' }}>
            <Bell />
            {unread > 0 && <span className="dot-badge" />}
          </Link>
        </div>
      }
      header={
        <div className="stack gap-1 grow" style={{ paddingBottom: 8 }}>
          <span className="t-sm t-muted">
            {greeting}, {firstName(u.name)}.
          </span>
          <h1 className="t-h2">{mode === 'offer' ? 'Where are you driving today?' : 'Where are you heading?'}</h1>
        </div>
      }
    >
      <div className="stack gap-4">
        <InstallHint />
        <TripForm value={draft} onChange={(v) => { setDraft(v); setErrors({}) }} errors={errors} seatsLabel={mode === 'offer' ? 'Seats offered' : 'Seats'} maxSeats={mode === 'offer' ? Math.min(u.vehicle?.seats ?? 4, MAX_SEATS) : MAX_SEATS} />
        <div className="stack gap-2">
          <Button size="lg" block onClick={() => submit()} icon={mode === 'offer' ? <CarFront /> : <Search />}>
            {mode === 'offer' ? 'Offer a ride' : 'Find a ride'}
          </Button>
          {u.commute === 'both' && (
            <Button size="lg" block variant="secondary" icon={<CarFront />} onClick={() => submit('offer')}>
              Offer a ride instead
            </Button>
          )}
        </div>

        {(booking || offered) && (
          <section className="stack gap-2" style={{ marginTop: 8 }}>
            <h2 className="section__title">Upcoming</h2>
            {booking && <UpcomingBooking booking={booking} />}
            {offered && <UpcomingOffer ride={offered} />}
          </section>
        )}

        <section className="stack gap-2" style={{ marginTop: 8 }}>
          <div className="row row--between">
            <h2 className="section__title">Leaving soon</h2>
            {soon.length > 0 && <span className="t-caption t-muted">{soon.length} offered by VIT students</span>}
          </div>
          {feed.loading ? (
            <>
              <Skeleton h={64} style={{ borderRadius: 14 }} />
              <Skeleton h={64} style={{ borderRadius: 14 }} />
            </>
          ) : soon.length === 0 ? (
            <div className="feed-empty">
              <span className="t-body t-strong">No rides offered yet</span>
              <span className="t-sm t-muted">When a VIT student offers a ride, it appears here instantly.{canDrive ? ' Driving somewhere? Offer your empty seats.' : ''}</span>
              {canDrive && (
                <Button size="sm" variant="tonal" icon={<CarFront />} onClick={() => nav('/offer')} style={{ alignSelf: 'flex-start', marginTop: 8 }}>
                  Offer a Ride
                </Button>
              )}
            </div>
          ) : (
            soon.map((f) => <FeedRow key={f.ride.id} item={f} />)
          )}
        </section>
      </div>
    </MapScreen>
  )
}

function FeedRow({ item }: { item: FeedItem }) {
  const nav = useNavigate()
  const { ride, driver, vehicle } = item
  const left = ride.seatsTotal - ride.seatsBooked
  return (
    <button type="button" className="context-row context-row--emph" onClick={() => nav(`/ride/${ride.id}`, { state: { own: true } })}>
      <Avatar name={driver.name} src={driver.photo} size="sm" verified={driver.verified} />
      <span className="stack grow" style={{ minWidth: 0 }}>
        <span className="t-body t-strong row gap-1 truncate" style={{ display: 'flex' }}>
          <span className="truncate">{ride.origin.name}</span>
          <ArrowRight size={14} className="t-muted" style={{ flex: 'none' }} />
          <span className="truncate">{ride.destination.name}</span>
        </span>
        <span className="t-sm t-muted truncate row gap-1" style={{ display: 'flex' }}>
          {dayTime(ride.departAt)} · {firstName(driver.name)} · <Rating value={driver.rating} /> · {vehicle.model}
        </span>
      </span>
      <span className="stack" style={{ alignItems: 'flex-end', gap: 4, flex: 'none' }}>
        <span className="t-body t-strong tabular">{money(ride.farePerSeat)}</span>
        {left > 0 ? <span className="t-caption t-primary t-strong">Book · {left} left</span> : <span className="t-caption t-muted">Full</span>}
      </span>
    </button>
  )
}

function UpcomingBooking({ booking }: { booking: TripItem }) {
  const nav = useNavigate()
  const s = BOOKING_STATUS[booking.status]
  const live = (LIVE_STATUSES as readonly string[]).includes(booking.status)
  return (
    <button type="button" className="context-row context-row--emph" onClick={() => nav(live ? `/live/${booking.id}` : `/trip/${booking.id}`)}>
      <Avatar name={booking.driver.name} src={booking.driver.photo} size="sm" verified={booking.driver.verified} />
      <span className="stack grow" style={{ minWidth: 0 }}>
        <span className="t-body t-strong truncate">
          {booking.pickup.name} → {booking.drop.name}
        </span>
        <span className="t-sm t-muted truncate">
          {firstName(booking.driver.name)} · {dayTime(booking.ride.departAt)}
        </span>
      </span>
      <Badge tone={s.tone}>{s.short}</Badge>
    </button>
  )
}

function UpcomingOffer({ ride }: { ride: OfferedItem }) {
  const nav = useNavigate()
  return (
    <button type="button" className="context-row context-row--emph" onClick={() => nav(`/drive/${ride.id}`)}>
      <span className="list-row__icon" style={{ background: 'var(--primary-50)', color: 'var(--primary-600)' }}>
        <CarFront />
      </span>
      <span className="stack grow" style={{ minWidth: 0 }}>
        <span className="t-body t-strong truncate">
          {ride.origin.name} → {ride.destination.name}
        </span>
        <span className="t-sm t-muted truncate">
          You’re driving · {time(ride.departAt)} · {ride.seatsBooked}/{ride.seatsTotal} seats filled
        </span>
      </span>
      {ride.pending > 0 ? <Badge tone="error">{ride.pending} new</Badge> : ride.status === 'in_progress' ? <Badge tone="success">Live</Badge> : <ChevronRight size={18} className="t-muted" />}
    </button>
  )
}
