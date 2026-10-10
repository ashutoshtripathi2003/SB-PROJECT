import { useEffect, useState, useSyncExternalStore } from 'react'
import type {
  RiderLocation,
  AppNotification,
  Booking,
  BookingDetail,
  DriverLocation,
  MatchResult,
  Message,
  PaymentRecord,
  Place,
  PublicUser,
  Ride,
  RideDetail,
  RidePreference,
  SearchQuery,
  ServerEvent,
  Thread,
  Trips,
  User,
  Vehicle,
} from '@/lib/types'

/* ==========================================================================
   Transport
   ========================================================================== */

export type ApiErrorCode = 'network' | 'auth' | 'forbidden' | 'validation' | 'conflict' | 'not_found' | 'rate_limited' | 'server'

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public field?: string,
    public status = 0,
  ) {
    super(message)
  }
}

const CODE: Record<number, ApiErrorCode> = { 400: 'validation', 401: 'auth', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 429: 'rate_limited' }

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'x-ridesync': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('network', 'You’re offline or the server can’t be reached. Check your connection and try again.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError(CODE[res.status] ?? 'server', data.error ?? 'Something went wrong. Please try again.', data.field, res.status)
  }
  return data as T
}

const get = <T>(path: string) => request<T>('GET', path)
const post = <T = { ok: true }>(path: string, body: unknown = {}) => request<T>('POST', path, body)

/* ==========================================================================
   Query cache — a tiny SWR. Every subscribed key refetches on server events.
   ========================================================================== */

type Entry = { data?: unknown; error?: ApiError; loading: boolean; promise?: Promise<void>; subs: number }
const cache = new Map<string, Entry>()
const listeners = new Set<() => void>()
let version = 0
const bump = () => {
  version++
  listeners.forEach((l) => l())
}

function load(key: string) {
  const e = cache.get(key) ?? { loading: true, subs: 0 }
  cache.set(key, e)
  if (e.promise) return e.promise
  e.loading = e.data === undefined
  e.promise = get(key)
    .then((data) => {
      e.data = data
      e.error = undefined
    })
    .catch((err: ApiError) => {
      e.error = err
    })
    .finally(() => {
      e.loading = false
      e.promise = undefined
      bump()
    })
  bump()
  return e.promise
}

/** Refetch everything on screen (after a mutation or a server push). */
export function revalidate() {
  for (const [key, e] of cache) {
    if (e.subs > 0) void load(key)
    else if (!e.promise) cache.delete(key)
  }
}

export function setCached<T>(key: string, data: T) {
  const e = cache.get(key) ?? { loading: false, subs: 0 }
  e.data = data
  e.error = undefined
  cache.set(key, e)
  bump()
}

export function useQuery<T>(key: string | null) {
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
  )
  useEffect(() => {
    if (!key) return
    const e = cache.get(key) ?? { loading: true, subs: 0 }
    cache.set(key, e)
    e.subs++
    if (e.data === undefined && !e.promise) void load(key)
    return () => {
      e.subs--
    }
  }, [key])
  const e = key ? cache.get(key) : undefined
  return {
    data: e?.data as T | undefined,
    error: e?.error,
    loading: key ? !e || (e.data === undefined && !e.error) : false,
    reload: () => (key ? load(key) : Promise.resolve()),
  }
}

/* ==========================================================================
   Live events (Server-Sent Events)
   ========================================================================== */

type LocationListener = (rideId: string, loc: DriverLocation) => void
const notificationListeners = new Set<(n: AppNotification) => void>()
const locationListeners = new Set<LocationListener>()
type RiderLocationListener = (rideId: string, bookingId: string, loc: RiderLocation) => void
const riderLocationListeners = new Set<RiderLocationListener>()
const connListeners = new Set<() => void>()
const syncListeners = new Set<() => void>()
let source: EventSource | null = null
let syncTimer: number | undefined
let connected = false

let pollTimer: number | undefined
const onVisible = () => {
  if (document.visibilityState === 'visible') revalidate()
}

export function connectEvents() {
  if (source) return
  source = new EventSource('/api/events', { withCredentials: true })
  // Safety net: if a proxy delays live updates, open screens still refresh every 15 s
  // and as soon as the tab comes back into view.
  pollTimer = window.setInterval(() => document.visibilityState === 'visible' && revalidate(), 15_000)
  document.addEventListener('visibilitychange', onVisible)
  source.onopen = () => {
    connected = true
    connListeners.forEach((l) => l())
    revalidate() // catch up on anything missed while disconnected
  }
  source.onerror = () => {
    connected = false
    connListeners.forEach((l) => l())
  }
  source.onmessage = (msg) => {
    let ev: ServerEvent
    try {
      ev = JSON.parse(msg.data)
    } catch {
      return
    }
    if (ev.type === 'location') {
      locationListeners.forEach((l) => l(ev.rideId, ev.location))
      return
    }
    if (ev.type === 'riderLocation') {
      riderLocationListeners.forEach((l) => l(ev.rideId, ev.bookingId, ev.location))
      return
    }
    if (ev.type === 'notification') notificationListeners.forEach((l) => l(ev.notification))
    window.clearTimeout(syncTimer)
    syncTimer = window.setTimeout(() => {
      revalidate()
      syncListeners.forEach((l) => l())
    }, 120)
  }
}

/** Called whenever the server says data changed (e.g. a new ride was published). */
export function onSync(fn: () => void) {
  syncListeners.add(fn)
  return () => {
    syncListeners.delete(fn)
  }
}

export function disconnectEvents() {
  source?.close()
  source = null
  window.clearInterval(pollTimer)
  document.removeEventListener('visibilitychange', onVisible)
  connected = false
  connListeners.forEach((l) => l())
}

export function useLiveConnected() {
  return useSyncExternalStore(
    (l) => {
      connListeners.add(l)
      return () => connListeners.delete(l)
    },
    () => connected,
  )
}

export function onNotification(fn: (n: AppNotification) => void) {
  notificationListeners.add(fn)
  return () => {
    notificationListeners.delete(fn)
  }
}

/** Driver's live position: initial value from the API, then pushed updates. */
export function useDriverLocation(rideId: string | undefined, initial?: DriverLocation) {
  const [loc, setLoc] = useState<DriverLocation | undefined>(initial)
  useEffect(() => {
    if (initial && (!loc || initial.at > loc.at)) setLoc(initial)
  }, [initial?.at]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!rideId) return
    const fn: LocationListener = (id, l) => id === rideId && setLoc(l)
    locationListeners.add(fn)
    return () => {
      locationListeners.delete(fn)
    }
  }, [rideId])
  return loc
}

/** Driver: each rider's live location (by booking id), starting from what the ride detail had. */
export function useRiderLocations(rideId: string | undefined, initial: Record<string, RiderLocation | undefined>) {
  const [locs, setLocs] = useState<Record<string, RiderLocation>>({})
  const merged: Record<string, RiderLocation> = {}
  for (const [k, v] of Object.entries(initial)) if (v) merged[k] = v
  for (const [k, v] of Object.entries(locs)) if (!merged[k] || v.at > merged[k].at) merged[k] = v
  useEffect(() => {
    if (!rideId) return
    const fn: RiderLocationListener = (id, bookingId, l) => id === rideId && setLocs((m) => ({ ...m, [bookingId]: l }))
    riderLocationListeners.add(fn)
    return () => {
      riderLocationListeners.delete(fn)
    }
  }, [rideId])
  return merged
}

/* ==========================================================================
   Auth & profile
   ========================================================================== */

export type AppConfig = {
  allowedDomain: string
  googleClientId: string | null
  microsoftLogin: boolean
  emailLogin: boolean
  codesInTerminal: boolean
  devLogin: boolean
  razorpayKeyId: string | null
  maps: {
    tiles: { url: string; attribution: string }
    /** Set when the server has a Google Maps key and the Google map is turned on. */
    google: { browserKey: string } | null
    search: 'google' | 'ola' | 'maptiler' | 'openstreetmap'
    routing: 'google' | 'tomtom' | 'openrouteservice' | 'osrm'
    /** Live traffic layer available at /api/traffic/{z}/{x}/{y}.png */
    traffic?: boolean
    /** Vector map style (MapTiler with a key, else OpenFreeMap). */
    vectorStyle?: string
    /** Vector styles to try in order (Ola Maps first when set up). */
    vectorStyles?: string[]
    olaKey?: string | null
  }
}

export function useConfig() {
  const q = useQuery<AppConfig>('/config')
  const retryable = !!q.error && !q.data
  useEffect(() => {
    if (!retryable) return
    const t = setTimeout(() => void q.reload(), 1500)
    return () => clearTimeout(t)
  }, [retryable, q.error]) // eslint-disable-line react-hooks/exhaustive-deps
  return q
}

/** user: null = signed out, undefined = still loading. */
export function useMe(): { user: User | null | undefined; error?: ApiError } {
  const q = useQuery<User>('/me')
  // The server may still be starting (or briefly unreachable): keep retrying quietly.
  const retryable = !!q.error && !q.data && (q.error.code === 'network' || q.error.code === 'server')
  useEffect(() => {
    if (!retryable) return
    const t = setTimeout(() => void q.reload(), 1500)
    return () => clearTimeout(t)
  }, [retryable, q.error]) // eslint-disable-line react-hooks/exhaustive-deps
  if (q.error?.code === 'auth') return { user: null }
  if (q.error && !q.data) return { user: undefined, error: q.error }
  return { user: q.data }
}

type AuthResult = { user: User; isNew: boolean }
const afterLogin = (r: AuthResult) => {
  setCached('/me', r.user)
  connectEvents()
  return r
}

function signedOut() {
  disconnectEvents()
  cache.clear()
  cache.set('/me', { loading: false, subs: 0, error: new ApiError('auth', 'Signed out', undefined, 401) })
  bump()
}

export const auth = {
  google: (credential: string) => post<AuthResult>('/auth/google', { credential }).then(afterLogin),
  requestCode: (email: string) => post('/auth/code/request', { email }),
  verifyCode: (email: string, code: string) => post<AuthResult>('/auth/code/verify', { email, code }).then(afterLogin),
  dev: (email: string) => post<AuthResult>('/auth/dev', { email }).then(afterLogin),
  logout: async () => {
    await post('/auth/logout').catch(() => {})
    signedOut()
  },
}

export type ProfilePatch = Partial<Pick<User, 'name' | 'phone' | 'studentId' | 'programme' | 'gender' | 'commute' | 'upiId' | 'preferences' | 'emergencyContacts' | 'photo'>> & {
  onboarded?: true
}

export async function updateMe(patch: ProfilePatch) {
  const u = await request<User>('PATCH', '/me', patch)
  setCached('/me', u)
  return u
}

/** Student ID card photo for the Verified badge (reviewed by a RideSync admin). */
export async function uploadIdCard(image: string) {
  const u = await request<User>('PUT', '/me/id-card', { image })
  setCached('/me', u)
  return u
}

export type IdOcr = { status: 'done' | 'failed'; nameMatch: boolean; idMatch: boolean; nameScore: number; confidence: number; text: string; at: string }
export type IdCardReview = { userId: string; name: string; email: string; studentId: string; programme?: string; image: string; submittedAt: string; ocr?: IdOcr }
export const admin = {
  review: (userId: string, approve: boolean, note?: string) => mutate(post(`/admin/id-cards/${userId}`, { approve, note })),
  train: () => mutate(post('/admin/ml/train')),
  addDemo: () => mutate(post<{ added: DemoCount; demo: DemoCount }>('/admin/demo')),
  removeDemo: () => mutate(request<{ removed: DemoCount; demo: DemoCount }>('DELETE', '/admin/demo')),
}

export type AssistantAction =
  | { type: 'search'; label: string; query: { pickup: Place; drop: Place; date?: string; time?: string; seats?: number } }
  | { type: 'link'; label: string; to: string }
  | { type: 'call'; label: string; tel: string }
export type AssistantReply = { intent: string; confidence: number; reply: string; actions: AssistantAction[]; suggestions: string[] }
export const assistant = { ask: (text: string) => post<AssistantReply>('/assistant', { text }) }

export type DemoCount = { users: number; rides: number; bookings: number }
export type MlModel = {
  name: 'match' | 'risk' | 'eta' | 'demand'
  title: string
  method: string
  status: 'trained' | 'waiting'
  samples: number
  needed: number
  trainedAt?: string
  metrics?: Record<string, number | null>
  baseline?: Record<string, number | null>
  importance?: { feature: string; weight: number; direction: 'up' | 'down' }[]
  note?: string
}
export type MlReport = {
  models: MlModel[]
  forecast: { hours: { at: string; expected: number }[]; areas: { area: string; trips: number }[]; backtestMae: number | null } | null
  demo: DemoCount
  assistant?: { accuracy: number; examples: number; intents: number; messages30d: number; understoodRate: number | null; topIntents: { intent: string; n: number }[] }
}

export async function saveVehicle(v: Omit<Vehicle, 'id'>) {
  const u = await request<User>('PUT', '/me/vehicle', v)
  setCached('/me', u)
  return u
}

export async function removeVehicle() {
  const u = await request<User>('DELETE', '/me/vehicle')
  setCached('/me', u)
  return u
}

export async function deleteAccount() {
  await request('DELETE', '/me')
  signedOut()
}

/* ==========================================================================
   Rides & bookings
   ========================================================================== */

export type SearchResponse = { results: MatchResult[]; ridesInWindow: number }
export type FeedItem = { ride: Ride; driver: PublicUser; vehicle: Vehicle }
export type TrafficLevel = 'light' | 'moderate' | 'heavy'
export type RouteInfo = {
  coords: { lat: number; lng: number }[]
  distanceKm: number
  durationMin: number
  source: 'google' | 'tomtom' | 'osrm' | 'estimate'
  /** Extra minutes caused by traffic right now (live traffic only). */
  trafficDelayMin?: number
  traffic?: TrafficLevel
  /** Slow / heavy / standstill stretches by index into coords; the rest is clear. */
  segments?: TrafficSegment[]
}
export type TrafficSegment = { from: number; to: number; level: 'slow' | 'heavy' | 'severe' }
export type LiveEta = {
  durationMin: number
  distanceKm: number
  trafficDelayMin: number
  traffic: TrafficLevel | null
  source: RouteInfo['source']
  /** With { route: true } and live traffic: the current route and its slow stretches. */
  coords?: { lat: number; lng: number }[]
  segments?: TrafficSegment[]
}
/** Driving time between two points, including live traffic when the server has it. */
export const liveEta = (from: { lat: number; lng: number }, to: { lat: number; lng: number }, opts: { route?: boolean; departAt?: string } = {}) =>
  get<LiveEta>(
    `/eta?fromLat=${from.lat.toFixed(5)}&fromLng=${from.lng.toFixed(5)}&toLat=${to.lat.toFixed(5)}&toLng=${to.lng.toFixed(5)}${opts.route ? '&route=1' : ''}${opts.departAt ? `&departAt=${encodeURIComponent(opts.departAt)}` : ''}`,
  )

export const searchPlacesRemote = (q: string, session?: string) =>
  get<Place[]>(`/places?q=${encodeURIComponent(q)}${session ? `&s=${encodeURIComponent(session)}` : ''}`)
/** Fill in the coordinates of a Google search suggestion. */
export const resolvePlaceRemote = (placeId: string, session?: string) =>
  get<Place>(`/places/resolve?id=${encodeURIComponent(placeId)}${session ? `&s=${encodeURIComponent(session)}` : ''}`)

export type OnlineOrder = { keyId: string; orderId: string; amount: number; currency: string; description: string; prefill: { name: string; email: string; contact: string } }
export const payOnline = {
  createOrder: (bookingId: string) => post<OnlineOrder>(`/bookings/${bookingId}/pay/online`),
  verify: (bookingId: string, r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
    mutate(post(`/bookings/${bookingId}/pay/online/verify`, r)),
}

export type WalletTx = { id: string; kind: 'topup' | 'ride' | 'earning' | 'refund'; amount: number; note: string; bookingId?: string; createdAt: string }
export type WalletInfo = { balance: number; testMode: boolean; canTopUp: boolean; transactions: WalletTx[] }
export const wallet = {
  topUpOrder: (amount: number) => post<OnlineOrder>('/wallet/topup', { amount }),
  verifyTopUp: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => mutate(post<{ ok: true; balance: number }>('/wallet/topup/verify', r)),
  payBooking: (bookingId: string) => mutate(post<{ ok: true; balance: number }>(`/bookings/${bookingId}/pay/wallet`)),
}

export const searchRides = (q: SearchQuery) => post<SearchResponse>('/rides/search', q)
export const matchRide = (rideId: string, query: SearchQuery) => post<{ match: MatchResult | null }>(`/rides/${rideId}/match`, { query }).then((r) => r.match)
export const routePreview = (from: Place, to: Place) => post<RouteInfo>('/route', { from, to })

export type OfferInput = {
  origin: Place
  destination: Place
  departAt: string
  seats: number
  farePerSeat: number
  maxDetourKm: number
  preferences: RidePreference[]
  note?: string
  womenOnly?: boolean
}

async function mutate<T>(p: Promise<T>) {
  const r = await p
  revalidate()
  return r
}

export const rides = {
  publish: (o: OfferInput) => mutate(post<Ride>('/rides', o)),
  cancel: (id: string, reason: string) => mutate(post(`/rides/${id}/cancel`, { reason })),
  start: (id: string) => mutate(post(`/rides/${id}/start`)),
  complete: (id: string) => mutate(post(`/rides/${id}/complete`)),
  location: (id: string, lat: number, lng: number, heading: number | null) => post(`/rides/${id}/location`, { lat, lng, heading }),
}

export const bookings = {
  request: (rideId: string, query: SearchQuery, message?: string) => mutate(post<Booking>('/bookings', { rideId, query, message })),
  respond: (id: string, accept: boolean) => mutate(post(`/bookings/${id}/respond`, { accept })),
  pay: (id: string, method: 'upi' | 'cash', reference?: string) => mutate(post(`/bookings/${id}/pay`, { method, reference })),
  paymentReceived: (id: string) => mutate(post(`/bookings/${id}/payment-received`)),
  cancel: (id: string, reason: string) => mutate(post(`/bookings/${id}/cancel`, { reason })),
  arrived: (id: string) => mutate(post(`/bookings/${id}/arrived`)),
  pickedUp: (id: string, pin?: string) => mutate(post(`/bookings/${id}/picked-up`, { pin })),
  noShow: (id: string) => mutate(post(`/bookings/${id}/no-show`)),
  riderLocation: (id: string, lat: number, lng: number, accuracy: number | null) => post(`/bookings/${id}/rider-location`, { lat, lng, accuracy }),
  share: (id: string) => post<{ url: string; text: string; local: boolean }>(`/bookings/${id}/share`),
  dropped: (id: string) => mutate(post(`/bookings/${id}/dropped`)),
  rate: (id: string, stars: number, tags: string[], comment: string) => mutate(post(`/bookings/${id}/rate`, { stars, tags, comment })),
  send: (id: string, text: string) => mutate(post(`/bookings/${id}/messages`, { text })),
}

export const notifications = {
  readAll: () => mutate(post('/notifications/read-all')),
  read: (id: string) => mutate(post(`/notifications/${id}/read`)),
}

/** Query keys */
export const Q = {
  ride: (id: string) => `/rides/${id}`,
  booking: (id: string) => `/bookings/${id}`,
  messages: (id: string) => `/bookings/${id}/messages`,
  trips: '/trips',
  feed: '/rides/feed',
  threads: '/threads',
  notifications: '/notifications',
  payments: '/payments',
  wallet: '/wallet',
  idCards: '/admin/id-cards',
  shared: (token: string) => `/share/${token}`,
  badges: '/badges',
}

export type Badges = { unread: number; requests: number }
export type { AppNotification, BookingDetail, Message, PaymentRecord, RideDetail, Thread, Trips }

/** Statuses where a booking is live on the road. */
export const LIVE_STATUSES = ['driver_arriving', 'driver_arrived', 'in_progress'] as const

/* ==========================================================================
   Device permissions
   ========================================================================== */

export type PermissionState = 'unknown' | 'granted' | 'denied' | 'unsupported'

export function notificationPermission(): PermissionState {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission === 'default' ? 'unknown' : (Notification.permission as PermissionState)
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  if (typeof Notification === 'undefined') return 'unsupported'
  const r = await Notification.requestPermission()
  return r === 'default' ? 'unknown' : (r as PermissionState)
}

export function requestLocation(): Promise<Place> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new ApiError('validation', 'Location isn’t available on this device.'))
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        const place: Place = { id: `here-${lat.toFixed(5)},${lng.toFixed(5)}`, name: 'Current location', area: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng, kind: 'custom' }
        // Name the spot ("Near Dadar TT Circle") when the server can.
        get<{ name: string; area: string }>(`/places/reverse?lat=${lat}&lng=${lng}`)
          .then((r) => resolve({ ...place, name: r.name || place.name, area: r.area || place.area }))
          .catch(() => resolve(place))
      },
      (err) => reject(new ApiError('validation', err.code === err.PERMISSION_DENIED ? 'Location permission denied' : 'Couldn’t get your location. Try again.')),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    )
  })
}

/**
 * Best position in a few seconds: browsers often return a rough Wi-Fi/IP fix
 * first and a sharper GPS one shortly after.
 */
export function locatePrecise(): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new ApiError('validation', 'Location isn’t available on this device.'))
    let best: GeolocationPosition | null = null
    const finish = () => {
      navigator.geolocation.clearWatch(id)
      window.clearTimeout(t)
      if (best) resolve({ lat: best.coords.latitude, lng: best.coords.longitude, accuracy: best.coords.accuracy })
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos
        if (best.coords.accuracy <= 20) finish()
      },
      (err) => {
        if (best) return finish()
        navigator.geolocation.clearWatch(id)
        window.clearTimeout(t)
        reject(new ApiError('validation', err.code === err.PERMISSION_DENIED ? 'Location permission denied' : 'Couldn’t get your location. Try again.'))
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    )
    const t = window.setTimeout(() => {
      if (best) finish()
    }, 6000)
  })
}

/** Name for a spot on the map (prefers buildings and landmarks). */
export async function reversePlace(lat: number, lng: number): Promise<{ name: string; area: string }> {
  return get<{ name: string; area: string }>(`/places/reverse?lat=${lat}&lng=${lng}`)
}
