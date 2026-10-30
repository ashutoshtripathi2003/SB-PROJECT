/* Shared between the browser app and the API server. */

export type LatLng = { lat: number; lng: number }

export type Place = {
  id: string
  name: string
  area: string
  lat: number
  lng: number
  kind?: 'campus' | 'station' | 'airport' | 'area' | 'custom'
  /** Google search suggestion: coordinates are filled in when it's picked. */
  googlePlaceId?: string
}

/** How a student usually gets to college (for the CO₂ estimate, server/co2.ts). */
export type TravelMode = 'car' | 'cab' | 'auto' | 'bike' | 'train' | 'bus' | 'walk'

export type CommuteMode = 'driver' | 'rider' | 'both'
export type Gender = 'female' | 'male' | 'other' | 'undisclosed'

export type RidePreference = 'quiet' | 'female_friendly' | 'no_smoking' | 'no_pets' | 'minimal_detour' | 'music_ok' | 'ac'

export type Vehicle = {
  id: string
  make: string
  model: string
  color: string
  plate: string
  seats: number // passenger seats excluding driver
  fuel: 'petrol' | 'diesel' | 'cng' | 'ev'
  /** Car size: decides how much fuel it burns at a given traffic speed (src/lib/fuel.ts). */
  body?: 'hatchback' | 'sedan' | 'suv'
}

/** What other students can see about you. */
export type PublicUser = {
  id: string
  name: string
  photo?: string
  programme?: string
  rating: number // 0 when there are no ratings yet
  ratingCount: number
  ridesOffered: number
  ridesTaken: number
  completionRate: number // 0–1
  /** Student ID card checked by RideSync. */
  verified?: boolean
}

/** The signed-in user. */
export type User = PublicUser & {
  email: string
  phone: string
  studentId: string
  gender: Gender
  commute?: CommuteMode
  /** How they usually got to college before RideSync; decides the CO₂ their shared rides save. */
  usualMode?: TravelMode
  upiId?: string
  preferences: RidePreference[]
  emergencyContacts: { name: string; phone: string }[]
  vehicle?: Vehicle
  onboarded: boolean
  co2SavedKg: number
  createdAt: string
  /** Student ID card check: none → pending → verified / rejected. */
  idStatus: IdStatus
  idNote?: string
  /** Can approve student ID cards. */
  isAdmin?: boolean
  /** Admin with a non-college email: dashboard only, no rides. */
  adminOnly?: boolean
}

export type IdStatus = 'none' | 'pending' | 'verified' | 'rejected'

export type RideStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'

export type DriverLocation = { lat: number; lng: number; heading?: number; at: string }
/** Rider's phone GPS while waiting for pickup (like Uber/Ola): shown to their driver only. */
export type RiderLocation = { lat: number; lng: number; accuracy?: number; at: string }

export type Ride = {
  id: string
  driverId: string
  origin: Place
  destination: Place
  departAt: string // ISO
  seatsTotal: number
  seatsBooked: number
  farePerSeat: number
  maxDetourKm: number
  preferences: RidePreference[]
  vehicleId: string
  note?: string
  status: RideStatus
  createdAt: string
  distanceKm: number
  durationMin: number
  route: LatLng[]
  driverLocation?: DriverLocation
  /** Only female students can see and book it. */
  womenOnly?: boolean
  /** 'share': the trip's real cost split equally among everyone in the car (fair fares); 'fixed': older rides. */
  fareMode?: 'fixed' | 'share'
  /** Estimated cost of the whole trip (km × ₹ per km + minutes × ₹ per minute), and how it was worked out. */
  costTotal?: number
  costSummary?: string
}

export type BookingStatus =
  | 'pending' // requested, awaiting driver
  | 'accepted' // driver accepted, rider to choose payment
  | 'rejected'
  | 'confirmed' // seat confirmed
  | 'driver_arriving' // ride started, driver on the way to this rider
  | 'driver_arrived'
  | 'in_progress' // rider picked up
  | 'completed'
  | 'cancelled'

/** upi = direct to the driver's UPI ID · cash = at pickup · online = through the payment gateway (Razorpay) */
export type PaymentMethodKind = 'upi' | 'cash' | 'online' | 'wallet'
/** paid_online = collected by the gateway · refunded = returned by the gateway after a cancellation */
export type PaymentStatus = 'unpaid' | 'marked_paid' | 'received' | 'paid_online' | 'refunded'

export type Booking = {
  id: string
  rideId: string
  riderId: string
  pickup: Place
  drop: Place
  seats: number
  fare: number // total for all seats: the current share (final once the trip starts)
  /** The km this rider travels in the car. */
  riderKm?: number
  /** Estimated CO₂ saved by sharing (server/co2.ts): the rider's replaced trips minus the driver's detour. */
  co2Kg?: number
  /** Fair fares: the most this booking can cost; `fare` falls below it as more riders join. */
  fareMax?: number
  /** True once the driver started the trip and the share is fixed. */
  fareFinal?: boolean
  /** What the rider has paid so far (wallet, online or UPI). */
  paidAmount?: number
  /** After the fare was fixed: > 0 the rider still owes this, < 0 the driver returns it (UPI). */
  settleDue?: number
  status: BookingStatus
  matchScore: number
  createdAt: string
  updatedAt: string
  message?: string
  paymentMethod?: PaymentMethodKind
  paymentStatus: PaymentStatus
  paymentRef?: string
  paidAt?: string
  arrivedAt?: string
  pickedUpAt?: string
  droppedAt?: string
  cancelledBy?: 'rider' | 'driver'
  cancelReason?: string
  riderRating?: number // rider → driver
  driverRating?: number // driver → rider
}

export type Message = {
  id: string
  threadId: string // booking id
  senderId: string
  text: string
  createdAt: string
  system?: boolean
}

export type NotificationKind = 'request' | 'accepted' | 'rejected' | 'cancelled' | 'payment' | 'arriving' | 'match' | 'system' | 'chat'

export type AppNotification = {
  id: string
  userId: string
  kind: NotificationKind
  title: string
  body: string
  createdAt: string
  read: boolean
  link?: string
}

export type SearchQuery = {
  pickup: Place
  drop: Place
  date: string // yyyy-mm-dd (rider's local date)
  time: string // HH:mm (rider's local time)
  at?: string // ISO instant of date+time, set by the client so servers in any timezone agree
  seats: number
  preferences: RidePreference[]
}

export type MatchFactors = {
  route: number
  time: number
  pickup: number
  preference: number
  reliability: number
}

export type MatchResult = {
  ride: Ride
  driver: PublicUser
  vehicle: Vehicle
  score: number // 0–100
  factors: MatchFactors
  tier: 'excellent' | 'good' | 'fair' | 'poor'
  pickupDistanceKm: number
  dropDistanceKm: number
  timeDiffMin: number
  detourKm: number
  fare: number // per seat for this rider (fair fares: their share right now)
  /** Fair fares: the most it can cost per seat (if no one else joins). */
  fareMax?: number
  /** Part of the driver's route this rider travels (0–1). */
  shareFraction?: number
  /** The same trip alone on the meter (Mumbai auto and taxi, approximate), per person. */
  meter?: { auto: number; taxi: number }
  reasons: string[]
  caveats: string[]
  history?: string
  /** ML: chance (0–1) the driver accepts a request like this one, when the model is trained. */
  aiChance?: number
}

/* ---- API response shapes -------------------------------------------------- */

export type RiderInfo = PublicUser & { phone?: string }

export type RideDetail = {
  ride: Ride
  driver: PublicUser
  vehicle: Vehicle
  myBooking?: Booking
  /** Only for the driver of the ride. */
  bookings?: (Booking & { rider: RiderInfo; riderLocation?: RiderLocation; noShowRisk?: number })[]
}

export type BookingDetail = {
  role: 'rider' | 'driver'
  booking: Booking
  ride: Ride
  driver: PublicUser
  vehicle: Vehicle
  rider: PublicUser
  driverPhone?: string
  driverUpiId?: string
  riderPhone?: string
  /** Rider only: 4-digit code the driver must enter at pickup. */
  ridePin?: string
}

/** Public, read-only live view of a trip shared with family or friends. */
export type SharedTrip = {
  rider: string
  driver: { name: string; photo?: string; rating: number; verified?: boolean }
  vehicle: { make: string; model: string; color: string; plate: string }
  pickup: Place
  drop: Place
  departAt: string
  status: BookingStatus
  rideStatus: RideStatus
  route: LatLng[]
  driverLocation?: DriverLocation
  pickedUpAt?: string
  droppedAt?: string
}

export type TripItem = Booking & { ride: Ride; driver: PublicUser }
export type OfferedItem = Ride & { pending: number; earned: number; riders: number }
export type Trips = { bookings: TripItem[]; rides: OfferedItem[] }

export type Thread = { bookingId: string; ride: Ride; other: PublicUser; last?: Message; status: BookingStatus }

export type PaymentRecord = {
  bookingId: string
  direction: 'paid' | 'received'
  amount: number
  method: PaymentMethodKind
  status: PaymentStatus
  reference?: string
  counterparty: string
  route: string
  at: string
}

export type ServerEvent =
  | { type: 'sync' }
  | { type: 'notification'; notification: AppNotification }
  | { type: 'location'; rideId: string; location: DriverLocation }
  | { type: 'riderLocation'; rideId: string; bookingId: string; location: RiderLocation }
