import { MotionConfig } from 'framer-motion'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { CelebrateProvider } from './components/Celebrate'
import { ToastProvider } from './components/Toast'
import { AppShell } from './layouts/AppShell'
import { Landing, Login, Splash } from './screens/auth'
import { DesignSystem, StatesGallery } from './screens/design'
import { DriverRide, OfferRide } from './screens/drive'
import { FindRide, MatchResults } from './screens/find'
import { Home } from './screens/home'
import { ChatList, ChatThread, Inbox, Notifications } from './screens/inbox'
import { LiveRide } from './screens/live'
import { Onboarding } from './screens/onboarding'
import { Payment } from './screens/payment'
import { Profile, ProfileSection, Settings } from './screens/profile'
import { RideDetails } from './screens/rideDetails'
import { MyRides } from './screens/rides'
import { TripStatus } from './screens/trip'
import { Wallet } from './screens/wallet'
import { SharedTripPage } from './screens/sharedTrip'
import { AdminApp } from './screens/admin'
import { DeleteAccount, PrivacyPolicy, TermsOfUse } from './screens/legal'
import { SearchProvider } from './state/search'

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <CelebrateProvider>
        <SearchProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Splash />} />
              <Route path="/welcome" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/design-system" element={<DesignSystem />} />
              <Route path="/states" element={<StatesGallery />} />
              <Route path="/t/:token" element={<SharedTripPage />} />
              <Route path="/privacy" element={<PrivacyPolicy />} />
              <Route path="/terms" element={<TermsOfUse />} />
              <Route path="/delete-account" element={<DeleteAccount />} />
              <Route path="/admin" element={<AdminApp />} />
              <Route path="/admin/:tab" element={<AdminApp />} />

              {/* Primary destinations — bottom navigation on mobile */}
              <Route element={<AppShell nav />}>
                <Route path="/home" element={<Home />} />
                <Route path="/find" element={<FindRide />} />
                <Route path="/find/results" element={<MatchResults />} />
                <Route path="/rides" element={<MyRides />} />
                <Route path="/wallet" element={<Wallet />} />
                <Route path="/profile" element={<Profile />} />
              </Route>

              {/* Focused flows — no bottom navigation */}
              <Route element={<AppShell nav={false} />}>
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/ride/:rideId" element={<RideDetails />} />
                <Route path="/trip/:bookingId" element={<TripStatus />} />
                <Route path="/pay/:bookingId" element={<Payment />} />
                <Route path="/live/:bookingId" element={<LiveRide />} />
                <Route path="/offer" element={<OfferRide />} />
                <Route path="/drive/:rideId" element={<DriverRide />} />
                <Route path="/inbox" element={<Inbox />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/chat" element={<ChatList />} />
                <Route path="/chat/:bookingId" element={<ChatThread />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/profile/:section" element={<ProfileSection />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </SearchProvider>
        </CelebrateProvider>
      </ToastProvider>
    </MotionConfig>
  )
}
