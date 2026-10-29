import { BellRing, CarFront, CircleCheck, Clock, Footprints, Mail, MapPinOff, Search, Siren, Phone, MessageCircle, Share2, TriangleAlert, X, IdCard, CircleX, WifiOff } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import { MatchBreakdown, MatchScore } from '@/components/MatchScore'
import { RideCard } from '@/components/RideCard'
import { ModalSheet } from '@/components/Sheet'
import { LocationDenied, NetworkError, StateView } from '@/components/States'
import { Stops } from '@/components/Stops'
import { useToast } from '@/components/Toast'
import {
  Avatar,
  Badge,
  Button,
  Chip,
  Field,
  ListRow,
  Notice,
  Plate,
  Rating,
  RideCardSkeleton,
  Seats,
  Segmented,
  Skeleton,
  Stepper,
  Switch,
  Tabs,
  VerifiedBadge,
} from '@/components/ui'
import { placeById } from '@/data/places'
import { hhmm, isoDate } from '@/lib/format'
import { polylineLengthKm, syntheticRoute } from '@/lib/geo'
import { scoreRide } from '@/lib/matching'
import type { MatchResult, Place, Ride, SearchQuery } from '@/lib/types'
import { validateCollegeEmail, validateStudentId } from '@/lib/validation'
import { SuccessMark } from './trip'

/** Sample match results for documentation only — computed with the real scoring code. */
function useSamples(): MatchResult[] {
  return useMemo(() => {
    const campus = placeById('vit-campus')!
    const sample = (id: string, name: string, to: string, pickup: Place, minutesOff: number, rating: number, count: number, model: string, prefs: SearchQuery['preferences'] = []) => {
      const destination = placeById(to)!
      const coords = syntheticRoute(campus, destination)
      const depart = new Date(Date.now() + 3 * 3600_000)
      const ride: Ride = {
        id, driverId: id, origin: campus, destination, departAt: depart.toISOString(), seatsTotal: 3, seatsBooked: 0, farePerSeat: 120,
        maxDetourKm: 3, preferences: ['no_smoking'], vehicleId: 'v', status: 'scheduled', createdAt: '', distanceKm: polylineLengthKm(coords), durationMin: 55, route: coords,
      }
      const at = new Date(depart.getTime() - minutesOff * 60_000)
      const q: SearchQuery = { pickup, drop: destination, date: isoDate(at), time: hhmm(at), at: at.toISOString(), seats: 1, preferences: prefs }
      const driver = { id, name, rating, ratingCount: count, ridesOffered: count, ridesTaken: 2, completionRate: 0.96 }
      return scoreRide({ query: q, ride, route: { coords, distanceKm: ride.distanceKm, durationMin: 55 }, driver, vehicle: { id: 'v', make: 'Honda', model, color: 'White', plate: 'MH 01 AB 1234', seats: 3, fuel: 'petrol' } })
    }
    return [
      sample('s1', 'Rahul Sharma', 'malad', campus, 5, 4.8, 32, 'City'),
      sample('s2', 'Ananya Iyer', 'andheri', placeById('wadala-rd')!, 10, 4.9, 47, 'Amaze'),
      sample('s3', 'Karan Mehta', 'thane', placeById('sion')!, 70, 4.4, 9, 'Jazz', ['quiet']),
    ].filter((m): m is MatchResult => !!m)
  }, [])
}

function Block({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className="ds-block">
      <div className="stack gap-1">
        <h2 className="t-h2">{title}</h2>
        {note && <p className="t-sm t-muted">{note}</p>}
      </div>
      {children}
    </section>
  )
}

const COLORS: { group: string; items: [string, string, string?][] }[] = [
  { group: 'Primary · Indigo', items: [['--primary-50', '#F4F2FF'], ['--primary-100', '#EBE7FF'], ['--primary-200', '#D8D0FE'], ['--primary-400', '#8F79F7'], ['--primary-600', '#5038E6', 'Brand'], ['--primary-700', '#422BC8', 'Hover'], ['--primary-900', '#2A1D7A']] },
  { group: 'Secondary & accent', items: [['--secondary-50', '#EEF2FF'], ['--secondary-500', '#4365F2', 'Mark blue'], ['--accent-500', '#6A3EF8', '“AI” violet']] },
  { group: 'Ink · Text', items: [['--ink-900', '#15182E', 'Primary text'], ['--ink-700', '#3A3D55', 'Secondary'], ['--ink-500', '#64677E', 'Tertiary'], ['--ink-400', '#8B8DA3', 'Placeholder'], ['--ink-200', '#D6D7E2']] },
  { group: 'Surfaces & borders', items: [['--surface', '#FFFFFF', 'Surface'], ['--bg-canvas', '#F6F5FB', 'Canvas'], ['--surface-sunken', '#F1F0F7', 'Sunken'], ['--border', '#E8E7F0', 'Border'], ['--border-strong', '#D4D3E1', 'Border strong']] },
  { group: 'Semantic', items: [['--success-500', '#14A454', 'Success / eco'], ['--success-50', '#E9F7EF'], ['--warning-500', '#D98A0B', 'Warning'], ['--warning-50', '#FFF6E2'], ['--error-500', '#E0323F', 'Error / SOS'], ['--error-50', '#FDEDEE'], ['--disabled-bg', '#EFEEF5', 'Disabled']] },
]

const TYPE: [string, string, string][] = [
  ['t-display', 'Display', '32 / 38 · Jakarta 600'],
  ['t-h1', 'Heading 1', '26 / 32 · Jakarta 700'],
  ['t-h2', 'Heading 2', '20 / 26 · Jakarta 700'],
  ['t-h3', 'Heading 3', '17 / 24 · Jakarta 600'],
  ['t-body-lg', 'Body large', '16 / 24 · Inter 400'],
  ['t-body', 'Body', '15 / 22 · Inter 400'],
  ['t-sm', 'Body small', '13 / 18 · Inter 400'],
  ['t-caption', 'Caption', '12 / 16 · Inter 500'],
  ['t-overline', 'Overline', '11 / 14 · Inter 600 · +8%'],
]

export function DesignSystem() {
  const toast = useToast()
  const samples = useSamples()
  const [seg, setSeg] = useState<'best' | 'earliest' | 'fare'>('best')
  const [tab, setTab] = useState<'upcoming' | 'active' | 'completed'>('upcoming')
  const [sw, setSw] = useState(true)
  const [seats, setSeats] = useState(2)
  const [chips, setChips] = useState<string[]>(['No smoking'])
  const [sheet, setSheet] = useState(false)

  return (
    <div className="ds">
      <header className="ds-head">
        <Logo height={30} />
        <nav className="row gap-4 t-sm">
          <a href="#foundations">Foundations</a>
          <a href="#components">Components</a>
          <Link to="/states">States</Link>
          <Link to="/">App</Link>
        </nav>
      </header>
      <main className="ds-main">
        <div className="stack gap-2" style={{ paddingBottom: 24 }}>
          <span className="t-overline t-muted">RideSync AI</span>
          <h1 className="t-display">Design system</h1>
          <p className="t-body-lg t-secondary" style={{ maxWidth: 640 }}>
            One quiet, trustworthy visual language built around the RideSync AI logo. Indigo for action, navy for reading, white surfaces, and colour only where it carries meaning.
          </p>
        </div>

        <div id="foundations" />
        <Block title="Logo" note="Always the supplied artwork. Crops only — never redrawn, recoloured or placed on busy backgrounds.">
          <div className="ds-grid ds-grid--3">
            <div className="ds-tile">
              <Logo variant="full" height={64} />
              <span className="t-caption t-muted">Full · splash, marketing</span>
            </div>
            <div className="ds-tile">
              <Logo variant="compact" height={36} />
              <span className="t-caption t-muted">Compact · headers, nav</span>
            </div>
            <div className="ds-tile">
              <Logo variant="mark" height={56} />
              <span className="t-caption t-muted">Mark · app icon, favicon</span>
            </div>
          </div>
        </Block>

        <Block title="Colour" note="Brand colours are sampled from the logo. Green only for success and eco; red only for errors, cancellation and SOS.">
          <div className="stack gap-5">
            {COLORS.map((g) => (
              <div key={g.group} className="stack gap-2">
                <span className="t-sm t-strong">{g.group}</span>
                <div className="ds-swatches">
                  {g.items.map(([token, hex, label]) => (
                    <div key={token} className="ds-swatch">
                      <span className="ds-swatch__chip" style={{ background: `var(${token})` }} />
                      <span className="t-caption">{label ?? token.replace('--', '')}</span>
                      <span className="t-caption t-muted tabular" style={{ fontWeight: 400 }}>
                        {hex}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Block>

        <Block title="Typography" note="Plus Jakarta Sans for headings (geometric, close to the wordmark). Inter for UI and body text with tabular numbers for times and fares.">
          <div className="stack">
            {TYPE.map(([cls, name, spec]) => (
              <div key={cls} className="ds-type-row">
                <span className={cls}>{name}</span>
                <span className="t-caption t-muted" style={{ fontWeight: 400 }}>
                  {spec}
                </span>
              </div>
            ))}
          </div>
        </Block>

        <Block title="Spacing, radius, elevation">
          <div className="ds-grid ds-grid--3">
            <div className="ds-tile ds-tile--left">
              <span className="t-sm t-strong">Spacing · 4pt grid</span>
              {[4, 8, 12, 16, 24, 32, 48].map((s) => (
                <div key={s} className="row gap-3">
                  <span style={{ width: s, height: 10, background: 'var(--primary-200)', borderRadius: 2 }} />
                  <span className="t-caption t-muted">{s}</span>
                </div>
              ))}
            </div>
            <div className="ds-tile ds-tile--left">
              <span className="t-sm t-strong">Radius</span>
              {[
                ['6', 'Tags'],
                ['10', 'Inputs'],
                ['14', 'Buttons, cards'],
                ['20', 'Panels, dialogs'],
                ['28', 'Bottom sheets'],
              ].map(([r, l]) => (
                <div key={r} className="row gap-3">
                  <span style={{ width: 36, height: 24, border: '1.5px solid var(--ink-300)', borderRadius: Number(r) / 2 }} />
                  <span className="t-caption t-muted">
                    {r}px · {l}
                  </span>
                </div>
              ))}
            </div>
            <div className="ds-tile ds-tile--left">
              <span className="t-sm t-strong">Elevation</span>
              {['xs', 'sm', 'md', 'lg', 'sheet'].map((s) => (
                <div key={s} className="row gap-3">
                  <span style={{ width: 36, height: 24, background: '#fff', borderRadius: 6, boxShadow: `var(--shadow-${s})` }} />
                  <span className="t-caption t-muted">shadow-{s}</span>
                </div>
              ))}
            </div>
          </div>
        </Block>

        <Block title="Motion" note="Fast and functional. 150 ms for feedback, 220 ms for transitions, 300 ms for routes and sheets. Springs (stiffness 420, damping 40) for sheets. Reduced-motion is respected.">
          <div className="ds-grid ds-grid--3">
            {[
              ['Micro-interaction', '150 ms · standard ease', 'Buttons, chips, toggles'],
              ['Transition', '220 ms · standard ease', 'Pages, tabs, content swaps'],
              ['Spatial', 'Spring 420 / 40', 'Bottom sheets, dialogs'],
              ['Route draw', '900 ms · decelerate', 'Map route on load'],
              ['Success', 'Spring + path draw', 'Payment, confirmation'],
              ['Loading', '1.3 s shimmer', 'Skeletons, never spinners for lists'],
            ].map(([a, b, c]) => (
              <div key={a} className="ds-tile ds-tile--left">
                <span className="t-sm t-strong">{a}</span>
                <span className="t-caption tabular">{b}</span>
                <span className="t-caption t-muted" style={{ fontWeight: 400 }}>
                  {c}
                </span>
              </div>
            ))}
          </div>
        </Block>

        <div id="components" />
        <Block title="Buttons" note="One primary action per screen. Large (56) for the main CTA, medium (48) default, small (36) inline.">
          <div className="stack gap-4">
            <div className="row wrap gap-3">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="tonal">Tonal</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="dark">Dark</Button>
              <Button variant="danger">Destructive</Button>
            </div>
            <div className="row wrap gap-3">
              <Button size="lg">Request Ride · ₹120</Button>
              <Button size="sm" icon={<CarFront />} variant="tonal">
                Offer a Ride
              </Button>
              <Button loading>Loading</Button>
              <Button disabled>Disabled</Button>
            </div>
          </div>
        </Block>

        <Block title="Inputs">
          <div className="ds-grid ds-grid--2">
            <Field label="VIT email" placeholder="firstname.lastname@vit.edu.in" leading={<Mail />} />
            <Field label="Student ID" defaultValue="VIT22CE118" valid leading={<IdCard />} />
            <Field label="VIT email" defaultValue="aarav@gmail.com" error={validateCollegeEmail('aarav@gmail.com')} leading={<Mail />} />
            <Field label="Full name" defaultValue="Aarav Menon" disabled hint="Matches your VIT records" />
          </div>
          <div className="row wrap gap-6" style={{ marginTop: 8 }}>
            <Stepper label="Seats" value={seats} onChange={setSeats} />
            <Switch label="Demo switch" checked={sw} onChange={setSw} />
            <Plate>MH 01 AB 1234</Plate>
          </div>
        </Block>

        <Block title="Selection">
          <div className="stack gap-4" style={{ maxWidth: 520 }}>
            <div className="row wrap gap-2">
              {['Quiet ride', 'Female-friendly', 'No smoking', 'No pets', 'Minimal detour'].map((c) => (
                <Chip key={c} selected={chips.includes(c)} onClick={() => setChips((l) => (l.includes(c) ? l.filter((x) => x !== c) : [...l, c]))}>
                  {c}
                </Chip>
              ))}
            </div>
            <Segmented label="Sort" value={seg} onChange={setSeg} options={[{ value: 'best', label: 'Best Match' }, { value: 'earliest', label: 'Earliest' }, { value: 'fare', label: 'Lowest Fare' }]} />
            <Tabs label="Rides" value={tab} onChange={setTab} tabs={[{ value: 'upcoming', label: 'Upcoming', count: 2 }, { value: 'active', label: 'Active' }, { value: 'completed', label: 'Completed' }]} />
          </div>
        </Block>

        <Block title="Identity & trust">
          <div className="row wrap gap-4">
            <Avatar name="Rahul Sharma" verified />
            <Avatar name="Ananya Iyer" size="lg" verified />
            <Avatar name="Priya Nair" size="sm" />
            <VerifiedBadge />
            <Rating value={4.8} count={32} />
            <Badge tone="success">Confirmed</Badge>
            <Badge tone="warning">Requested</Badge>
            <Badge tone="error">Cancelled</Badge>
            <Badge tone="info">Arriving</Badge>
            <Seats total={4} taken={1} />
          </div>
        </Block>

        <Block title="AI match" note="The score is always explainable. Tiers: excellent ≥ 85, good ≥ 70, fair ≥ 55, weak < 55. Weak matches are collapsed by default.">
          <div className="row wrap gap-3">
            <MatchScore score={94} tier="excellent" />
            <MatchScore score={78} tier="good" />
            <MatchScore score={61} tier="fair" />
            <MatchScore score={42} tier="poor" />
            <MatchScore score={94} tier="excellent" size="lg" />
          </div>
          {samples[0] && (
            <div className="ds-grid ds-grid--2" style={{ alignItems: 'start' }}>
              <div className="card card--pad">
                <span className="t-sm t-strong" style={{ display: 'block', marginBottom: 16 }}>
                  Why this match?
                </span>
                <MatchBreakdown match={samples[0]} />
              </div>
              <div className="stack gap-3">
                {samples.slice(0, 2).map((m) => (
                  <RideCard key={m.ride.id} match={m} onOpen={() => toast({ tone: 'info', message: 'Opens ride details' })} />
                ))}
              </div>
            </div>
          )}
        </Block>

        <Block title="Lists, routes, notices">
          <div className="ds-grid ds-grid--2" style={{ alignItems: 'start' }}>
            <div className="card card--pad stack gap-4">
              <Stops from={{ title: 'VIT Wadala', subtitle: 'Wadala (E)', time: '5:35 PM' }} to={{ title: 'Malad', subtitle: 'Malad Station' }} />
              <hr className="divider" />
              <div className="list">
                <ListRow icon={<CarFront />} title="Vehicle Information" subtitle="Maruti Baleno · MH 01 CD 9087" onClick={() => {}} />
                <ListRow icon={<BellRing />} title="Notifications" onClick={() => {}} />
              </div>
            </div>
            <div className="stack gap-3">
              <Notice tone="ai" icon={<Footprints />} title="AI insight">Leaving 10 minutes later gives you 3 more matches.</Notice>
              <Notice tone="info" icon={<Clock />}>Your seat is held for 15 minutes.</Notice>
              <Notice tone="warning" icon={<TriangleAlert />}>Pickup is 2.8 km from your location.</Notice>
              <Notice tone="error" icon={<X />}>Payment failed. You haven’t been charged.</Notice>
              <Notice tone="success" icon={<CircleCheck />}>Ride completed · ₹200 cost-share received.</Notice>
            </div>
          </div>
        </Block>

        <Block title="Overlays & feedback">
          <div className="row wrap gap-3">
            <Button variant="secondary" onClick={() => setSheet(true)}>
              Open bottom sheet
            </Button>
            <Button variant="secondary" onClick={() => toast({ tone: 'success', message: 'Ride confirmed', action: { label: 'View', onClick: () => {} } })}>
              Show toast
            </Button>
          </div>
          <div className="ds-grid ds-grid--2">
            <RideCardSkeleton />
            <div className="card card--pad stack gap-3">
              <Skeleton w="40%" />
              <Skeleton w="90%" h={10} />
              <Skeleton w="70%" h={10} />
            </div>
          </div>
          <ModalSheet open={sheet} onClose={() => setSheet(false)} title="Bottom sheet" footer={<Button size="lg" block onClick={() => setSheet(false)}>Primary action</Button>}>
            <p className="t-body t-secondary">Modal sheets slide up on mobile with a spring and become centred dialogs on larger screens. Escape and scrim tap dismiss.</p>
          </ModalSheet>
        </Block>
      </main>
    </div>
  )
}

/* ==========================================================================
   States gallery
   ========================================================================== */

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="frame">
      <figcaption className="t-caption t-muted">{label}</figcaption>
      <div className="frame__screen">{children}</div>
    </figure>
  )
}

function MiniHero({ mark, title, body, children }: { mark: ReactNode; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="hero" style={{ padding: '32px 16px' }}>
      {mark}
      <h2 className="t-h2">{title}</h2>
      <p className="t-sm t-muted">{body}</p>
      {children}
    </div>
  )
}

export function StatesGallery() {
  const samples = useSamples()
  const weak = samples.find((m) => m.tier === 'poor' || m.tier === 'fair') ?? samples[samples.length - 1]
  return (
    <div className="ds">
      <header className="ds-head">
        <Logo height={30} />
        <nav className="row gap-4 t-sm">
          <Link to="/design-system">Design system</Link>
          <Link to="/">App</Link>
        </nav>
      </header>
      <main className="ds-main" style={{ maxWidth: 1240 }}>
        <div className="stack gap-2" style={{ paddingBottom: 24 }}>
          <span className="t-overline t-muted">RideSync AI</span>
          <h1 className="t-display">Screen states</h1>
          <p className="t-body-lg t-secondary" style={{ maxWidth: 640 }}>
            Every state a rider or driver can hit, rendered with the production components. Each is reachable in the live app too.
          </p>
        </div>
        <div className="frames">
          <Frame label="Loading · AI matching">
            <div className="stack gap-3" style={{ padding: 16 }}>
              <div className="analysing">
                <div className="progress progress--indeterminate">
                  <div className="progress__bar" />
                </div>
                <span className="t-sm t-muted">Comparing routes, timing and pickup distance…</span>
              </div>
              <RideCardSkeleton />
              <RideCardSkeleton />
            </div>
          </Frame>
          <Frame label="Empty · no rides offered">
            <StateView icon={<CarFront />} title="No rides offered yet" body="No one has offered a ride around 6:30 PM today. Rides are usually posted a few hours before departure." actions={<Button block>Notify me when one is posted</Button>} />
          </Frame>
          <Frame label="No matching rides">
            <StateView icon={<Search />} tone="neutral" title="No matching rides" body="4 rides are offered around this time, but none pass close enough to your pickup." actions={<Button block>Adjust search</Button>} />
          </Frame>
          <Frame label="Poor AI match">
            <div className="stack gap-3" style={{ padding: 16 }}>
              <Notice tone="warning" icon={<TriangleAlert />} title="Only weak matches found">
                These rides leave far from your pickup or at a different time.
              </Notice>
              {weak && <RideCard match={{ ...weak, score: 46, tier: 'poor' }} onOpen={() => {}} />}
            </div>
          </Frame>
          <Frame label="Ride request pending">
            <MiniHero
              mark={
                <div className="radar">
                  <span className="radar__ring" />
                  <span className="radar__ring" />
                  <span className="radar__ring" />
                  <Avatar name="Rahul Sharma" size="xl" />
                </div>
              }
              title="Ride requested"
              body="Waiting for Rahul to accept. We’ll notify you."
            />
          </Frame>
          <Frame label="Ride accepted">
            <MiniHero mark={<SuccessMark />} title="Ride confirmed" body="Rahul accepted your request. Pay now to lock in your seat.">
              <Button block>Continue to Payment</Button>
            </MiniHero>
          </Frame>
          <Frame label="Ride rejected">
            <MiniHero mark={<div className="result-mark result-mark--error"><X /></div>} title="Rahul couldn’t take this ride" body="Plans change. You haven’t been charged.">
              <Button block>Find another match</Button>
            </MiniHero>
          </Frame>
          <Frame label="Ride cancelled">
            <MiniHero mark={<div className="result-mark result-mark--error"><CircleX /></div>} title="Ride cancelled" body="Karan cancelled: car trouble. You haven’t been charged." />
          </Frame>
          <Frame label="Payment success">
            <MiniHero mark={<SuccessMark />} title="Seat confirmed" body="Rahul has been told you paid ₹120 by UPI." />
          </Frame>
          <Frame label="Payment failure">
            <StateView tone="error" icon={<X />} title="Couldn’t confirm payment" body="We couldn’t reach RideSync to record your payment. If your UPI app showed success, you’ve paid — tap retry to record it." actions={<><Button block>Retry</Button><Button variant="ghost" block>Pay cash instead</Button></>} />
          </Frame>
          <Frame label="Driver arriving">
            <LiveMini title="Arriving in 4 min" sub="Rahul is heading to VIT Wadala" progress={55} />
          </Frame>
          <Frame label="Ride started">
            <LiveMini title="18 min to Malad" sub="Enjoy the ride. Your trip is being tracked." progress={30} green />
          </Frame>
          <Frame label="Ride completed">
            <MiniHero mark={<SuccessMark />} title="You’ve arrived" body="Malad · ₹120 paid · ~2.8 kg CO₂ saved">
              <div className="row gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <span key={n} className="star-btn is-on" style={{ width: 36, height: 36 }}>
                    ★
                  </span>
                ))}
              </div>
            </MiniHero>
          </Frame>
          <Frame label="Network error">
            <NetworkError onRetry={() => {}} />
          </Frame>
          <Frame label="Location permission denied">
            <LocationDenied onManual={() => {}} onRetry={() => {}} />
          </Frame>
          <Frame label="Notification permission">
            <div style={{ padding: 16 }} className="stack gap-3">
              <Notice tone="ai" icon={<BellRing />} title="Get notified instantly" action={<Button size="sm" variant="tonal">Turn on</Button>}>
                Know the moment a driver accepts or arrives.
              </Notice>
              <Notice icon={<WifiOff />} title="Notifications are blocked">
                You’ll still see updates in the app.
              </Notice>
            </div>
          </Frame>
          <Frame label="Invalid VIT email">
            <div style={{ padding: 16 }}>
              <Field label="VIT email" defaultValue="aarav.menon@gmail.com" error={validateCollegeEmail('aarav.menon@gmail.com')} leading={<Mail />} />
            </div>
          </Frame>
          <Frame label="Invalid student ID">
            <div style={{ padding: 16 }} className="stack gap-4">
              <Field label="Student ID" defaultValue="22 BC" error={validateStudentId('22 BC')} leading={<IdCard />} />
            </div>
          </Frame>
          <Frame label="Location off · inline">
            <div style={{ padding: 16 }}>
              <Notice tone="warning" icon={<MapPinOff />} title="Location is blocked">
                Allow location for this site in your browser settings, or pick a place from the list.
              </Notice>
            </div>
          </Frame>
        </div>
      </main>
    </div>
  )
}

function LiveMini({ title, sub, progress, green }: { title: string; sub: string; progress: number; green?: boolean }) {
  return (
    <div className="stack gap-4" style={{ padding: 20 }}>
      <div className="stack gap-1">
        <h2 className="t-h1">{title}</h2>
        <p className="t-sm t-muted">{sub}</p>
      </div>
      <div className="progress">
        <div className="progress__bar" style={{ width: `${progress}%`, background: green ? 'var(--success-500)' : undefined }} />
      </div>
      <div className="row gap-3">
        <Avatar name="Rahul Sharma" verified />
        <div className="stack grow">
          <span className="t-body t-strong">Rahul Sharma</span>
          <span className="t-sm t-muted">White Honda City</span>
        </div>
        <Plate>MH 01 AB 1234</Plate>
      </div>
      <div className="actions-row">
        <span className="action-tile">
          <Phone />
          Call
        </span>
        <span className="action-tile">
          <MessageCircle />
          Chat
        </span>
        <span className="action-tile">
          <Share2 />
          Share
        </span>
        <span className="action-tile action-tile--danger">
          <Siren />
          SOS
        </span>
      </div>
    </div>
  )
}
