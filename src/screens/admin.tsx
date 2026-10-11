import { BadgeCheck, Brain, CarFront, ChartColumn, IdCard, LogOut, RefreshCw, Search, ShieldCheck, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import { NetworkError, StateView } from '@/components/States'
import { Badge, Button, Chip, RideCardSkeleton, cx } from '@/components/ui'
import { dayTime, money, relative } from '@/lib/format'
import { Q, admin, auth, useMe, useQuery, type FuelPrices as Prices, type IdCardReview } from '@/services/api'
import { AiTab } from './adminAi'
import { Review } from './adminVerify'

/* ---- Types (match /api/admin/*) ------------------------------------------ */

type Stats = {
  users: { total: number; onboarded: number; drivers: number; newThisWeek: number; verified: number; pendingIds: number; rejectedIds: number }
  rides: { total: number; scheduled: number; live: number; completed: number; cancelled: number; womenOnly: number }
  bookings: { total: number; pending: number; upcoming: number; live: number; completed: number; cancelled: number; cancelledByRider: number; cancelledByDriver: number; declined: number; expired: number; sharedTrips: number }
  money: { fares: number; online: number; walletTopups: number; refunds: number; co2Kg: number }
  daily: { day: string; offered: number; booked: number; completed: number; cancelled: number }[]
  eta?: { trips: number; shownErrorMin: number | null; tomtomErrorMin: number | null; olaErrorMin: number | null; mapplsErrorMin: number | null }
}
type AdminRide = {
  id: string
  driver: string
  from: string
  to: string
  departAt: string
  createdAt: string
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
  womenOnly: boolean
  seatsTotal: number
  farePerSeat: number
  riders: { name: string; status: string; seats: number; fare: number; cancelledBy?: string; reason?: string }[]
}
type AdminUser = { id: string; name: string; email: string; studentId: string; phone: string; gender: string; idStatus: string; onboarded: boolean; hasCar: boolean; offered: number; taken: number; cancels: number; createdAt: string }

/** Re-fetch every `ms` so the dashboard stays live. */
function usePoll(reload: () => unknown, ms = 20_000) {
  const ref = useRef(reload)
  ref.current = reload
  useEffect(() => {
    const t = window.setInterval(() => void ref.current(), ms)
    return () => window.clearInterval(t)
  }, [ms])
}

/* ---- Shell: dedicated admin area, own sign-in --------------------------- */

const TABS = [
  { to: '/admin', label: 'Overview', icon: <ChartColumn />, end: true },
  { to: '/admin/rides', label: 'Rides', icon: <CarFront /> },
  { to: '/admin/users', label: 'Students', icon: <Users /> },
  { to: '/admin/ids', label: 'ID checks', icon: <IdCard /> },
  { to: '/admin/ai', label: 'AI', icon: <Brain /> },
]

export function AdminApp() {
  const { user } = useMe()
  const { tab } = useParams()
  const loc = useLocation()
  const nav = useNavigate()
  const stats = useQuery<Stats>(user?.isAdmin ? '/admin/stats' : null)

  if (user === undefined) return <div className="admin" />
  if (!user) return <AdminSignIn from={loc.pathname} />
  if (!user.isAdmin)
    return (
      <div className="admin-gate">
        <Logo />
        <h1 className="t-h2">Admins only</h1>
        <p className="t-body t-muted">
          {user.email} isn’t a RideSync admin. Add it with <strong>setup.bat</strong> → “Set the admin email”, then restart start.bat.
        </p>
        <Button variant="secondary" onClick={() => nav('/home')}>
          Back to RideSync
        </Button>
      </div>
    )

  const pending = stats.data?.users.pendingIds ?? 0
  return (
    <div className="admin">
      <header className="admin__bar">
        <div className="row gap-3">
          <Logo />
          <Badge tone="dark">Admin</Badge>
        </div>
        <div className="row gap-2">
          <span className="t-sm t-muted only-desktop">{user.email}</span>
          <Button size="sm" variant="ghost" icon={<LogOut />} onClick={() => auth.logout()}>
            <span className="only-desktop">Sign out</span>
          </Button>
        </div>
      </header>
      <nav className="admin__tabs" aria-label="Admin sections">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cx('admin__tab', isActive && 'is-active')}>
            {t.icon}
            {t.label}
            {t.to === '/admin/ids' && pending > 0 && <span className="admin__count">{pending}</span>}
          </NavLink>
        ))}
      </nav>
      <main className="admin__main">
        {tab === 'rides' ? <RidesTab /> : tab === 'users' ? <UsersTab /> : tab === 'ids' ? <IdsTab /> : tab === 'ai' ? <AiTab /> : tab ? <Navigate to="/admin" replace /> : <Overview q={stats} />}
      </main>
    </div>
  )
}

function AdminSignIn({ from }: { from: string }) {
  const nav = useNavigate()
  return (
    <div className="admin-gate">
      <Logo />
      <span className="admin-gate__icon">
        <ShieldCheck />
      </span>
      <h1 className="t-h2">RideSync Admin</h1>
      <p className="t-body t-muted">See rides, bookings, cancellations and students in one place, and approve student ID cards. Sign in with your admin email.</p>
      <Button size="lg" block onClick={() => nav('/login', { state: { from } })}>
        Sign in as admin
      </Button>
    </div>
  )
}

/* ---- Overview ------------------------------------------------------------ */

function Overview({ q }: { q: ReturnType<typeof useQuery<Stats>> }) {
  usePoll(q.reload)
  if (q.loading) return <RideCardSkeleton />
  if (!q.data) return <NetworkError onRetry={q.reload} />
  const s = q.data
  const doneRate = s.bookings.completed + s.bookings.cancelled ? Math.round((s.bookings.completed / (s.bookings.completed + s.bookings.cancelled)) * 100) : null
  return (
    <div className="stack gap-6">
      <div className="row row--between wrap gap-2">
        <div className="stack gap-1">
          <h1 className="t-h2">Overview</h1>
          <span className="t-sm t-muted">Live · updates every 20 seconds</span>
        </div>
        <Button size="sm" variant="secondary" icon={<RefreshCw />} onClick={q.reload}>
          Refresh
        </Button>
      </div>

      <section className="admin-tiles admin-tiles--hero">
        <Tile label="Rides completed" value={s.rides.completed} />
        <Tile label="Seats booked" value={s.bookings.total} sub={`${s.bookings.completed} completed trips`} />
        <Tile label="Cancelled" value={s.bookings.cancelled} sub={`${s.bookings.cancelledByRider} by riders · ${s.bookings.cancelledByDriver} by drivers`} />
        <Tile label="Live right now" value={s.rides.live} sub={`${s.bookings.live} riders on the way`} live={s.rides.live > 0} />
      </section>

      <ActivityChart daily={s.daily} />

      <div className="admin-grid">
        <Group title="Rides offered">
          <Row label="Total offered" value={s.rides.total} />
          <Row label="Upcoming" value={s.rides.scheduled} />
          <Row label="Live now" value={s.rides.live} />
          <Row label="Completed" value={s.rides.completed} />
          <Row label="Cancelled by driver" value={s.rides.cancelled} />
          <Row label="Women-only rides" value={s.rides.womenOnly} />
        </Group>
        <Group title="Bookings">
          <Row label="Waiting for driver" value={s.bookings.pending} />
          <Row label="Confirmed, upcoming" value={s.bookings.upcoming} />
          <Row label="Completed" value={s.bookings.completed} />
          <Row label="Cancelled" value={s.bookings.cancelled} />
          <Row label="Declined by driver" value={s.bookings.declined} />
          <Row label="Expired (no reply)" value={s.bookings.expired} />
          {doneRate !== null && <Row label="Completion rate" value={`${doneRate}%`} />}
        </Group>
        <Group title="Students & safety">
          <Row label="Students signed up" value={s.users.total} />
          <Row label="Finished onboarding" value={s.users.onboarded} />
          <Row label="Drivers (with a car)" value={s.users.drivers} />
          <Row label="New this week" value={s.users.newThisWeek} />
          <Row label="ID verified" value={s.users.verified} />
          <Row label="ID cards waiting" value={s.users.pendingIds} accent={s.users.pendingIds > 0} />
          <Row label="Trips shared with family" value={s.bookings.sharedTrips} />
        </Group>
        <Group title="Money & impact">
          <Row label="Fares on completed trips" value={money(s.money.fares)} />
          <Row label="Paid online" value={money(s.money.online)} />
          <Row label="Wallet top-ups" value={money(s.money.walletTopups)} />
          <Row label="Refunds" value={s.money.refunds} />
          <Row label="CO₂ saved" value={`${s.money.co2Kg} kg`} />
        </Group>
        <FuelPrices />
        <Group title="Trip-time accuracy">
          {!s.eta?.trips ? (
            <p className="t-sm t-muted">Shows how close RideSync’s trip times were to the real pickup→drop time, once trips are completed. RideSync uses these trips to correct TomTom, Ola and Mappls automatically.</p>
          ) : (
            <>
              <Row label="Trips measured" value={s.eta.trips} />
              <Row label="RideSync off by (avg)" value={s.eta.shownErrorMin === null ? '—' : `${s.eta.shownErrorMin} min`} accent />
              <Row label="TomTom alone" value={s.eta.tomtomErrorMin === null ? '—' : `${s.eta.tomtomErrorMin} min`} />
              <Row label="Ola alone" value={s.eta.olaErrorMin === null ? '—' : `${s.eta.olaErrorMin} min`} />
              <Row label="Mappls alone" value={s.eta.mapplsErrorMin === null ? '—' : `${s.eta.mapplsErrorMin} min`} />
            </>
          )}
        </Group>
      </div>
    </div>
  )
}

const FUELS: { key: keyof Prices; label: string; unit: string }[] = [
  { key: 'petrol', label: 'Petrol', unit: '₹ / litre' },
  { key: 'diesel', label: 'Diesel', unit: '₹ / litre' },
  { key: 'cng', label: 'CNG', unit: '₹ / kg' },
  { key: 'ev', label: 'Electric', unit: '₹ / unit (kWh)' },
]

/** Today's fuel prices in Mumbai, used to work out every new trip's cost (fair fares). */
function FuelPrices() {
  const [prices, setPrices] = useState<Record<string, string> | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    admin
      .fuelPrices()
      .then((r) => setPrices(Object.fromEntries(Object.entries(r.prices).map(([k, v]) => [k, String(v)]))))
      .catch(() => setMsg('Couldn’t load fuel prices.'))
  }, [])
  async function save() {
    if (!prices) return
    const body = Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, Number(v)]))
    if (Object.values(body).some((n) => !(n >= 1 && n <= 500))) return setMsg('Each price must be between ₹1 and ₹500.')
    setSaving(true)
    setMsg(null)
    try {
      await admin.setFuelPrices(body)
      setMsg('Saved. New trips use these prices.')
    } catch {
      setMsg('Couldn’t save. Try again.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="admin-group">
      <h2 className="t-h3">Fuel prices</h2>
      <p className="t-sm t-muted">Trip costs (and so every fare) use these. Update them when pump prices change.</p>
      {prices ? (
        <div className="stack gap-2" style={{ marginTop: 8 }}>
          {FUELS.map((f) => (
            <label key={f.key} className="row row--between gap-2">
              <span className="t-sm">
                {f.label} <span className="t-muted">{f.unit}</span>
              </span>
              <input className="input" style={{ width: 96, textAlign: 'right' }} inputMode="decimal" value={prices[f.key]} onChange={(e) => setPrices({ ...prices, [f.key]: e.target.value.replace(/[^0-9.]/g, '').slice(0, 6) })} aria-label={`${f.label} price`} />
            </label>
          ))}
          <Button size="sm" loading={saving} onClick={save}>
            Save prices
          </Button>
        </div>
      ) : null}
      {msg && <p className="t-sm t-muted" style={{ marginTop: 6 }}>{msg}</p>}
    </section>
  )
}

function Tile({ label, value, sub, live }: { label: string; value: number | string; sub?: string; live?: boolean }) {
  return (
    <div className="admin-tile">
      <span className="t-sm t-muted row gap-2">
        {live && <span className="admin-live" aria-hidden />}
        {label}
      </span>
      <span className="admin-tile__value tabular">{value}</span>
      {sub && <span className="t-caption t-muted" style={{ fontWeight: 400 }}>{sub}</span>}
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="admin-group">
      <h2 className="t-h3">{title}</h2>
      <dl>{children}</dl>
    </section>
  )
}

function Row({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className="admin-row">
      <dt>{label}</dt>
      <dd className={cx('tabular', accent && 't-primary')}>{value}</dd>
    </div>
  )
}

/* ---- 14-day activity chart (grouped bars, hover tooltip, table view) ------ */

const SERIES = [
  { key: 'booked', label: 'Booked' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
] as const

function ActivityChart({ daily }: { daily: Stats['daily'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const max = Math.max(4, ...daily.flatMap((d) => SERIES.map((s) => d[s.key])))
  const top = Math.ceil(max / 4) * 4
  // Narrow screens get a narrower drawing so text stays readable.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const narrow = vw < 640
  const W = narrow ? 380 : vw < 1000 ? 700 : 1100
  const H = narrow ? 230 : 240
  const pad = { l: 28, r: 8, t: 8, b: 26 }
  const cw = (W - pad.l - pad.r) / daily.length
  const bw = Math.min(10, (cw - 10) / 3)
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top)
  const label = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  const totals = useMemo(() => Object.fromEntries(SERIES.map((s) => [s.key, daily.reduce((a, d) => a + d[s.key], 0)])), [daily])
  const bar = (x: number, v: number) => {
    const yy = y(v)
    const h = H - pad.b - yy
    if (h <= 0) return ''
    const r = Math.min(4, h, bw / 2)
    return `M${x},${H - pad.b} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${H - pad.b} Z`
  }

  return (
    <section className="admin-group viz">
      <div className="row row--between wrap gap-2">
        <div className="stack gap-1">
          <h2 className="t-h3">Bookings, last 14 days</h2>
          <div className="viz-legend" aria-label="Legend">
            {SERIES.map((s, i) => (
              <span key={s.key}>
                <i style={{ background: `var(--series-${i + 1})` }} />
                {s.label} <span className="t-muted tabular">{totals[s.key]}</span>
              </span>
            ))}
          </div>
        </div>
        <Chip size="sm" selected={table} onClick={() => setTable((t) => !t)}>
          Table view
        </Chip>
      </div>
      {table ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Rides offered</th>
                {SERIES.map((s) => (
                  <th key={s.key}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...daily].reverse().map((d) => (
                <tr key={d.day}>
                  <td>{label(d.day)}</td>
                  <td className="tabular">{d.offered}</td>
                  {SERIES.map((s) => (
                    <td key={s.key} className="tabular">
                      {d[s.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="viz-plot" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bookings, completed and cancelled trips per day for the last 14 days">
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <g key={f}>
                <line x1={pad.l} x2={W - pad.r} y1={y(top * f)} y2={y(top * f)} className={f === 0 ? 'viz-base' : 'viz-grid'} />
                <text x={pad.l - 6} y={y(top * f) + 4} textAnchor="end" className="viz-tick">
                  {Math.round(top * f)}
                </text>
              </g>
            ))}
            {daily.map((d, i) => {
              const x0 = pad.l + i * cw + (cw - (bw * 3 + 4)) / 2
              return (
                <g key={d.day}>
                  {hover === i && <rect x={pad.l + i * cw} y={pad.t} width={cw} height={H - pad.t - pad.b} className="viz-hover" />}
                  {SERIES.map((s, k) => (
                    <path key={s.key} d={bar(x0 + k * (bw + 2), d[s.key])} style={{ fill: `var(--series-${k + 1})` }} />
                  ))}
                  {(narrow ? i % 3 === 1 : i % 2 === 1) && (
                    <text x={pad.l + i * cw + cw / 2} y={H - 8} textAnchor="middle" className="viz-tick">
                      {label(d.day)}
                    </text>
                  )}
                  <rect x={pad.l + i * cw} y={0} width={cw} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
                </g>
              )
            })}
          </svg>
          {hover !== null && (
            <div className={cx('viz-tip', hover > daily.length / 2 ? 'viz-tip--left' : 'viz-tip--right')} style={{ left: `${((pad.l + hover * cw + cw / 2) / W) * 100}%` }}>
              <strong>{label(daily[hover].day)}</strong>
              <span className="t-muted">{daily[hover].offered} {daily[hover].offered === 1 ? "ride" : "rides"} offered</span>
              {SERIES.map((s, k) => (
                <span key={s.key} className="row gap-2">
                  <i style={{ background: `var(--series-${k + 1})` }} />
                  {s.label}
                  <b className="tabular">{daily[hover][s.key]}</b>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/* ---- Rides ---------------------------------------------------------------- */

const RIDE_FILTERS = [
  { v: '', l: 'All' },
  { v: 'in_progress', l: 'Live' },
  { v: 'scheduled', l: 'Upcoming' },
  { v: 'completed', l: 'Completed' },
  { v: 'cancelled', l: 'Cancelled' },
]
const RIDE_BADGE = { scheduled: ['info', 'Upcoming'], in_progress: ['success', '● Live'], completed: [undefined, 'Completed'], cancelled: ['error', 'Cancelled'] } as const
const RIDER_LABEL: Record<string, string> = {
  pending: 'requested',
  accepted: 'accepted',
  confirmed: 'confirmed',
  driver_arriving: 'waiting for pickup',
  driver_arrived: 'driver arrived',
  in_progress: 'in the car',
  completed: 'completed',
  cancelled: 'cancelled',
  rejected: 'declined',
  expired: 'expired',
}

function RidesTab() {
  const [status, setStatus] = useState('')
  const q = useQuery<AdminRide[]>(`/admin/rides${status ? `?status=${status}` : ''}`)
  usePoll(q.reload)
  return (
    <div className="stack gap-4">
      <h1 className="t-h2">Rides</h1>
      <div className="row wrap gap-2">
        {RIDE_FILTERS.map((f) => (
          <Chip key={f.v} selected={status === f.v} onClick={() => setStatus(f.v)}>
            {f.l}
          </Chip>
        ))}
      </div>
      {q.loading ? (
        <RideCardSkeleton />
      ) : !q.data ? (
        <NetworkError onRetry={q.reload} />
      ) : !q.data.length ? (
        <StateView compact icon={<CarFront />} tone="neutral" title="No rides here yet" body="Rides appear here the moment a student offers one." />
      ) : (
        <div className="stack gap-3">
          {q.data.map((r) => (
            <div key={r.id} className="admin-ride">
              <div className="row row--between gap-2">
                <span className="stack" style={{ minWidth: 0 }}>
                  <span className="t-body t-strong truncate">
                    {r.from} → {r.to}
                  </span>
                  <span className="t-sm t-muted">
                    {r.driver} · {dayTime(r.departAt)} · {money(r.farePerSeat)}/seat
                  </span>
                </span>
                <span className="row gap-2" style={{ flex: 'none' }}>
                  {r.womenOnly && <span className="badge badge--women">Women only</span>}
                  <Badge tone={RIDE_BADGE[r.status][0]}>{RIDE_BADGE[r.status][1]}</Badge>
                </span>
              </div>
              {r.riders.length ? (
                <ul className="admin-riders">
                  {r.riders.map((b, i) => (
                    <li key={i}>
                      <span className="truncate">{b.name}</span>
                      <span className={cx('t-sm', b.status === 'cancelled' || b.status === 'rejected' ? 't-error' : b.status === 'completed' ? 't-success' : 't-muted')}>
                        {RIDER_LABEL[b.status] ?? b.status}
                        {b.status === 'cancelled' && b.cancelledBy ? ` by ${b.cancelledBy}` : ''}
                        {b.reason ? ` · ${b.reason}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="t-sm t-muted">
                  No riders yet · {r.seatsTotal} {r.seatsTotal === 1 ? 'seat' : 'seats'} · offered {relative(r.createdAt).toLowerCase()}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---- Students ------------------------------------------------------------- */

function UsersTab() {
  const [text, setText] = useState('')
  const [term, setTerm] = useState('')
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(text.trim()), 300)
    return () => window.clearTimeout(t)
  }, [text])
  const q = useQuery<AdminUser[]>(`/admin/users${term ? `?q=${encodeURIComponent(term)}` : ''}`)
  return (
    <div className="stack gap-4">
      <h1 className="t-h2">Students</h1>
      <label className="admin-search">
        <Search />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search name, email or student ID" aria-label="Search students" />
      </label>
      {q.loading ? (
        <RideCardSkeleton />
      ) : !q.data ? (
        <NetworkError onRetry={q.reload} />
      ) : !q.data.length ? (
        <StateView compact icon={<Users />} tone="neutral" title="No students found" body={term ? 'Try another name or email.' : 'Students appear here after they sign in.'} />
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Student ID</th>
                <th>Phone</th>
                <th>ID check</th>
                <th>Offered</th>
                <th>Rides taken</th>
                <th>Cancels</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="stack">
                      <span className="t-strong row gap-1">
                        {u.name}
                        {u.idStatus === 'verified' && <BadgeCheck className="admin-tick" aria-label="Verified" />}
                      </span>
                      <span className="t-caption t-muted" style={{ fontWeight: 400 }}>
                        {u.email}
                        {u.hasCar ? ' · has a car' : ''}
                        {!u.onboarded ? ' · not finished sign-up' : ''}
                      </span>
                    </span>
                  </td>
                  <td>{u.studentId || '—'}</td>
                  <td>{u.phone ? `+91 ${u.phone}` : '—'}</td>
                  <td>
                    <Badge tone={u.idStatus === 'verified' ? 'verified' : u.idStatus === 'pending' ? 'warning' : u.idStatus === 'rejected' ? 'error' : 'outline'}>
                      {u.idStatus === 'none' ? 'Not sent' : u.idStatus === 'pending' ? 'Waiting' : u.idStatus === 'verified' ? 'Verified' : 'Rejected'}
                    </Badge>
                  </td>
                  <td className="tabular">{u.offered}</td>
                  <td className="tabular">{u.taken}</td>
                  <td className={cx('tabular', u.cancels >= 3 && 't-error')}>{u.cancels}</td>
                  <td className="t-muted">{relative(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ---- ID checks ------------------------------------------------------------ */

function IdsTab() {
  const q = useQuery<IdCardReview[]>(Q.idCards)
  usePoll(q.reload)
  return (
    <div className="stack gap-4">
      <h1 className="t-h2">ID checks</h1>
      <p className="t-body t-muted">Check that the name and student ID on the card match the profile. Approving gives the student the blue Verified tick; the photo is deleted either way.</p>
      {q.loading ? (
        <RideCardSkeleton />
      ) : q.error && !q.data ? (
        <NetworkError onRetry={q.reload} />
      ) : !q.data?.length ? (
        <StateView icon={<BadgeCheck />} tone="neutral" title="All caught up" body="New ID cards will appear here, and you’ll get a notification." />
      ) : (
        <div className="admin-ids">
          {q.data.map((c) => (
            <Review key={c.userId} c={c} onDone={q.reload} />
          ))}
        </div>
      )}
    </div>
  )
}
