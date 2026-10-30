import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { useConfig } from '@/services/api'

/**
 * Public Privacy Policy and Terms of Use (no sign-in), linked from the login screen,
 * Settings and the Android app. Written to match what the server actually stores and does;
 * update both when the data or features change.
 */
export const LEGAL_UPDATED = '29 October 2026'

function Contact() {
  const cfg = useConfig().data
  const email = cfg?.supportEmail
  return email ? (
    <a href={`mailto:${email}`}>{email}</a>
  ) : (
    <>the RideSync team through Help &amp; support in the app</>
  )
}

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const nav = useNavigate()
  return (
    <div className="legal">
      <header className="legal__top">
        <button type="button" className="link-btn legal__back" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))}>
          <ArrowLeft size={18} aria-hidden /> Back
        </button>
        <Logo />
      </header>
      <main className="legal__main">
        <h1 className="t-h1">{title}</h1>
        <p className="t-sm t-muted">Last updated: {LEGAL_UPDATED}</p>
        {children}
        <p className="legal__switch t-sm t-muted">
          <Link to="/privacy">Privacy Policy</Link> · <Link to="/terms">Terms of Use</Link> · <Link to="/delete-account">Delete your account</Link>
        </p>
      </main>
    </div>
  )
}

export function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        RideSync AI (“RideSync”, “we”) is a carpooling platform for verified students of Vidyalankar Institute of Technology (VIT), Mumbai, built and run
        by a team of VIT students. This policy explains what personal data we collect, why, who can see it and the choices you have. It is written for
        India’s Digital Personal Data Protection Act, 2023.
      </p>

      <h2>1. Data we collect</h2>
      <ul>
        <li>
          <b>Account:</b> your college email address, name, mobile number, student ID, programme and gender, and — only if you add them — a profile
          photo, UPI ID, ride preferences, emergency contacts and how you usually travelled to college (used only to estimate the CO₂ your shared rides
          save).
        </li>
        <li>
          <b>Student ID verification (optional):</b> a photo of your college ID card and the name and ID number read from it automatically (OCR), so an
          administrator can verify you.
        </li>
        <li>
          <b>Drivers:</b> car make, model, colour, number plate, seats, fuel type and — only if you add it — the car’s mileage (used for the suggested
          seat price).
        </li>
        <li>
          <b>Rides and bookings:</b> routes, pickup and drop points, times, seats, prices, booking status, cancellations and ratings.
        </li>
        <li>
          <b>Messages:</b> chat between a rider and driver about a booking.
        </li>
        <li>
          <b>Location:</b> during an active trip, the driver’s live location (and the rider’s, if they choose to share it) to show the car’s progress,
          estimate arrival and send off-route alerts. We do not track your location outside a trip.
        </li>
        <li>
          <b>Payments:</b> wallet entries and payment references from Razorpay. Card, UPI and bank details are entered with Razorpay or your UPI app;
          we never receive or store them.
        </li>
        <li>
          <b>Technical:</b> login sessions (stored only as secure hashes), your phone’s notification token, and network details such as IP address used
          to prevent abuse. For the chatbot we keep only which topic it detected, not what you typed.
        </li>
      </ul>

      <h2>2. How we use it</h2>
      <ul>
        <li>To run the service: sign-in, matching riders with drivers, bookings, payments, chat and live trip updates.</li>
        <li>For safety: checking that users are VIT students, ride PINs, trip sharing, SOS, off-route alerts and women-only rides.</li>
        <li>To contact you: one-time login codes by email and ride notifications.</li>
        <li>
          To improve RideSync: our own models learn from ride and booking records inside RideSync (for example, which rides get accepted and how long
          trips take). This data is not sent to outside AI services.
        </li>
        <li>To prevent fraud and misuse, and to meet legal obligations.</li>
      </ul>

      <h2>3. What other users can see</h2>
      <p>
        When you book or accept a ride, the other person sees your name, photo, rating and verification badge, the pickup and drop points, and — once a
        booking is accepted — your mobile number for calls. Riders also see the driver’s car and number plate, and the driver’s live location during the
        trip. If you share a trip link, anyone with the link can see that trip’s progress until shortly after it ends.
      </p>

      <h2>4. Service providers</h2>
      <p>We do not sell your data or show advertising. We share only what each provider needs to do its job:</p>
      <ul>
        <li>Oracle Cloud — hosting, in Mumbai, India.</li>
        <li>Google (Gmail) — delivering login-code emails.</li>
        <li>Razorpay — processing online payments and refunds.</li>
        <li>TomTom, Ola Maps, Mappls, OpenStreetMap / OSRM — maps, place search, routes and traffic (they receive locations and search text, not your name or email).</li>
        <li>Google Firebase — phone notifications.</li>
        <li>Microsoft — only if you choose to sign in with Microsoft.</li>
      </ul>

      <h2>5. Storage and security</h2>
      <p>
        Data is stored on our server in India and travels over encrypted HTTPS. Login codes and session tokens are stored only as hashes, access to the
        database is limited to the RideSync administrators, and backups are kept for 14 days.
      </p>

      <h2>6. How long we keep data</h2>
      <p>
        We keep your data while your account is active. When you delete your account (Settings → Delete account), we remove your name, email, mobile
        number, student ID, photo, UPI ID, emergency contacts, ID card photo, car details, logins and notification tokens. Records of past rides and
        payments are kept without your personal details, so other users’ histories and any disputes or refunds stay correct. Older copies in backups are
        overwritten within 14 days. You can also follow the steps on our <Link to="/delete-account">account deletion page</Link>.
      </p>

      <h2>7. Your rights</h2>
      <p>
        You can see and correct your details in your profile, delete your account at any time, and withdraw consent (by deleting your account). You may
        also ask us for a summary of your data, nominate someone to act for you, and raise a complaint. Contact <Contact />. If you are not satisfied
        with our response, you may approach the Data Protection Board of India.
      </p>

      <h2>8. Age</h2>
      <p>RideSync is meant for students aged 18 or over. Please do not use it if you are under 18.</p>

      <h2>9. Changes</h2>
      <p>If we change this policy, we will update the date above and tell you in the app when the change is important.</p>

      <h2>10. Contact</h2>
      <p>
        Questions or complaints about your data: <Contact />.
      </p>
    </LegalPage>
  )
}

/** Public account-deletion page (Google Play requires a web link, usable without the app). */
export function DeleteAccount() {
  return (
    <LegalPage title="Delete your RideSync account">
      <p>You can delete your RideSync AI account and its personal data at any time. Deleting is permanent and cannot be undone.</p>

      <h2>Delete it yourself (fastest)</h2>
      <ul>
        <li>
          <b>Android app:</b> open RideSync → <b>Profile</b> → <b>Delete account</b> → confirm.
        </li>
        <li>
          <b>Website:</b> sign in at <a href="/login">ridesync-vit.duckdns.org</a> → <b>Profile</b> → <b>Settings</b> → <b>Delete account</b> → confirm.
        </li>
      </ul>
      <p>Your upcoming rides and bookings are cancelled first, and riders and drivers on them are told. Online payments for cancelled bookings are refunded.</p>

      <h2>Can’t open the app?</h2>
      <p>
        Write to <Contact /> from your college email address and ask us to delete your account. We will confirm and delete it within 7 days.
      </p>

      <h2>What is deleted</h2>
      <ul>
        <li>Your name, college email, mobile number, student ID, programme, profile photo, UPI ID and emergency contacts.</li>
        <li>Your college ID card photo and the details read from it.</li>
        <li>Your car details, all logins on every device, and phone notification tokens.</li>
      </ul>

      <h2>What is kept</h2>
      <p>
        Records of past rides, bookings and payments are kept <b>without your name or contact details</b>, so other students’ trip histories, refunds
        and any disputes stay correct. Copies in our server backups are overwritten within 14 days.
      </p>
    </LegalPage>
  )
}

export function TermsOfUse() {
  return (
    <LegalPage title="Terms of Use">
      <p>
        These terms apply when you use the RideSync AI website or Android app. By creating an account you agree to them. If you do not agree, please do
        not use RideSync.
      </p>

      <h2>1. What RideSync is</h2>
      <p>
        RideSync helps verified VIT students who are travelling the same way share a car and split the fuel cost. RideSync is a platform that connects
        students; it is not a taxi or transport company, and it does not own cars or employ drivers. Each ride is an arrangement between the driver and
        the riders.
      </p>

      <h2>2. Who can use it</h2>
      <ul>
        <li>You must be a current VIT student with a working college email address, and at least 18 years old.</li>
        <li>One account per person. Your details must be true, and you are responsible for activity on your account.</li>
      </ul>

      <h2>3. Cost sharing, not business</h2>
      <p>
        Prices are meant only to share the cost of the trip. RideSync works out each rider’s share of the trip’s real fuel, toll and parking cost; drivers do not set
        their own price. Drivers must not use RideSync to make a profit or to run a commercial taxi service. RideSync does
        not currently charge a platform fee; if that changes, we will tell you before it applies.
      </p>

      <h2>4. If you drive</h2>
      <ul>
        <li>Hold a valid driving licence, and keep the car’s registration, insurance and PUC certificate valid.</li>
        <li>Drive a roadworthy car that matches the details and number plate in your profile.</li>
        <li>Follow traffic laws; never drive under the influence of alcohol or drugs, or while using your phone.</li>
        <li>Check the rider’s ride PIN before starting, and do not take riders beyond the seats you offered.</li>
      </ul>

      <h2>5. If you ride</h2>
      <ul>
        <li>Be at the pickup point on time, wear a seatbelt and treat the driver and car with respect.</li>
        <li>Only get in if the car and number plate match the app, and share your ride PIN only with your driver.</li>
        <li>Pay the agreed amount using the method you chose.</li>
      </ul>

      <h2>6. Bookings, cancellations and payments</h2>
      <p>
        A seat is confirmed only when the driver accepts your request. Riders pay drivers directly by UPI, cash, wallet or online payment. Online
        payments are processed by Razorpay; when a paid booking is cancelled, refunds follow the rules shown in the app. Please cancel as early as
        possible — frequent late cancellations or no-shows may lower your rating or lead to suspension.
      </p>

      <h2>7. Safety</h2>
      <p>
        RideSync offers safety tools such as ride PINs, trip sharing, off-route alerts, SOS and women-only rides, but it cannot guarantee anyone’s
        conduct. In an emergency, call 112. Report unsafe behaviour to the RideSync team so we can act on it.
      </p>

      <h2>8. Not allowed</h2>
      <ul>
        <li>Harassment, threats, discrimination or any illegal activity.</li>
        <li>Fake accounts, impersonation or false information.</li>
        <li>Carrying illegal or dangerous items, or misusing other users’ personal data.</li>
        <li>Interfering with the service, its security or other users’ accounts.</li>
      </ul>

      <h2>9. Suspension</h2>
      <p>We may suspend or remove accounts that break these terms or put others at risk. You can delete your account at any time in Settings.</p>

      <h2>10. Responsibility</h2>
      <p>
        RideSync is provided “as is” as a student-run service. We work to keep it accurate and available, but we cannot promise it will always be
        error-free or available. To the extent the law allows, RideSync and its team are not liable for the conduct of drivers or riders, or for loss,
        injury or damage arising from a ride arranged through the platform. Nothing in these terms limits rights you have under Indian law.
      </p>

      <h2>11. Law</h2>
      <p>These terms are governed by the laws of India, and the courts in Mumbai have jurisdiction.</p>

      <h2>12. Changes and contact</h2>
      <p>
        We may update these terms and will change the date above when we do. Questions: <Contact />. See also our <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </LegalPage>
  )
}
