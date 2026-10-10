# RideSync AI

AI-matched carpooling for VIT students. A student with a car offers empty seats, and another student heading the same way books one. Only verified **@vit.edu.in** accounts can sign in. The server enforces this on every login.

The app is a full stack: a React web app, a Node.js API, a SQLite database and live updates over Server-Sent Events. When a driver publishes a ride on one phone, it appears straight away on every other student's phone. Requests, acceptances, chat and the driver's live GPS position also move between devices in real time.

## Quick start (on your computer)

1. Install **Node.js 22 LTS** from https://nodejs.org. Just click Next through the installer.
2. Download this project: on GitHub, click **Code → Download ZIP**, then unzip it.
3. Start it:
   - **Windows:** double-click **`start.bat`**
   - **Mac:** right-click **`start.command`** → Open
   - **Linux:** run `./start.sh`
4. Your browser opens **http://localhost:5173**. Click **Create Account** and enter your `@vit.edu.in` email.
5. The 6-digit code appears in the **black terminal window**, because email sending isn't set up yet. Type it in and you're in.

The first start installs everything (about a minute). After that it starts in seconds. Keep the terminal window open while you use the app.

To test with two students on one computer, use a normal browser window for one and an **incognito/private** window for the other. Offer a ride in one, and it appears on the other's Home screen instantly.

---

## 1. Run it on your computer

You need **Node.js 22.13 or newer** (download it from https://nodejs.org).

```bash
npm install
cp .env.example .env      # on Windows: copy .env.example .env
npm run dev               # opens http://localhost:5173
```

To try two accounts on one computer before setting up Microsoft or email, set `DEV_LOGIN=true` in `.env`. A "Local development sign-in" box then appears on the login page. Use a normal window for one student and a private/incognito window for the other. This box **never** works in production.

Login codes are printed in the terminal while email isn't set up (local development only).

### Test on real phones (Android and iPhone)

1. Start RideSync with `start.bat`.
2. Double-click **`share.bat`**. The first time, it installs Cloudflare's free tunnel tool; run it again afterwards.
3. It prints a link like `https://something.trycloudflare.com`. Open it on any phone, on any network.

The link is **https**, so GPS and live location work on phones. It only works while your laptop, `start.bat` and `share.bat` are running, and it changes every time. It's for testing only; Sign in with Microsoft won't work through it, but email codes do.

Same Wi-Fi only (no GPS): open the "Network" address that `npm run dev` prints.

## 2. Turn on "Sign in with Microsoft" (recommended, free)

`@vit.edu.in` accounts are Microsoft 365 (Outlook) accounts, so students sign in with the same login they use for college email. Microsoft charges nothing for this.

1. Go to https://entra.microsoft.com and sign in with any Microsoft account (a personal Outlook/Hotmail account is fine).
2. Open **Applications → App registrations → New registration**.
   - **Name:** `RideSync`
   - **Supported account types:** *Accounts in any organizational directory (Any Microsoft Entra ID tenant – Multitenant)*
   - **Redirect URI:** platform **Web**, value `http://localhost:5173/api/auth/microsoft/callback`
3. After it's created, copy the **Application (client) ID** into `MICROSOFT_CLIENT_ID`.
4. Open **Certificates & secrets → New client secret**. Copy the **Value** (not the ID) into `MICROSOFT_CLIENT_SECRET`. Secrets expire; set a reminder to renew it.
5. When you deploy, add your live callback under **Authentication → Redirect URIs**, e.g. `https://your-app.onrender.com/api/auth/microsoft/callback`, and set `PUBLIC_URL=https://your-app.onrender.com`.

How the check works: the server finds VIT's Microsoft directory from the `vit.edu.in` domain and only accepts accounts from that directory, and the email must also end in `@vit.edu.in`. Personal Outlook or Hotmail accounts, and other colleges, are rejected.

**If students see "Need admin approval":** some colleges only allow apps their IT team has approved. Ask VIT IT to grant consent for "RideSync" (it only reads your name and email). Until then, students can use the email code below.

Google sign-in is also supported (`GOOGLE_CLIENT_ID`) for colleges whose email runs on Google; leave it empty for VIT.

## 3. Turn on email login codes (works for every student)

A backup that works even before IT approval: a 6-digit code sent to the student's `@vit.edu.in` Outlook inbox. Add any SMTP provider to `.env`. Gmail example:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your.address@gmail.com
SMTP_PASS=your-16-char-app-password      # Google Account → Security → App passwords
MAIL_FROM="RideSync <your.address@gmail.com>"
```

Brevo, Resend, Zoho and Amazon SES work the same way and scale better. Codes expire after 10 minutes, are single-use, and are rate-limited. Send yourself a test code first: Microsoft 365 can put mail from new senders in **Junk**. If it does, mark it "Not junk"; Brevo usually delivers more reliably than Gmail.

### Sending codes to thousands of students

Each student gets their own code, sent from your RideSync email account. Students stay logged in for **90 days** (`SESSION_DAYS`), so after launch a college of ~5,000 needs only about 50–60 codes a day.

Launch week is the busy time. Plan for it like this:

| Setup | Codes per day | Cost |
|---|---|---|
| Gmail only | ~500 | free |
| Gmail + Brevo backup (setup helper asks for it) | ~800 | free |
| Brevo paid / Amazon SES | thousands | low monthly cost |
| **Sign in with Microsoft** | unlimited (no email sent) | free |

The sending limits above are approximate; check each provider's current figures.

When the main account hits its daily limit, RideSync **switches to the backup automatically** and logs it in the terminal. If every account is used up, students see "Login emails are busy right now… or use Sign in with Microsoft" instead of waiting for a code that never arrives. To spread out the launch, open sign-ups one year or branch at a time.

## 3b. The easy way to set up email, payments and maps

Run the setup helper. It asks for each key, saves it to `.env`, and **sends you a real test email** (or checks your Razorpay keys) so you know it works:

- **Windows:** double-click **`setup.bat`**
- **Mac/Linux:** run `npm run setup`

Then close the black RideSync window and start it again.

## 3c. Online payments with Razorpay (optional)

1. Sign up at https://razorpay.com. **Test mode** works immediately, with no business documents.
2. In the Dashboard (Test mode), go to **Account & Settings → API Keys → Generate Test Key**.
3. Put the Key Id and Key Secret in `.env`, or use the setup helper:
   ```
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
   RAZORPAY_KEY_SECRET=xxxxxxxx
   ```
4. Restart RideSync. Riders now see **Pay online** (UPI, cards, netbanking) first. In test mode, pay with UPI ID `success@razorpay` or card `4111 1111 1111 1111`.

How it works:

- The server creates the order and verifies Razorpay's signature before confirming a seat.
- If a ride is cancelled, the money is **refunded automatically**.
- When you're online, add a webhook so payments confirm even if a rider closes the tab: Dashboard → **Webhooks** → URL `https://your-site/api/payments/razorpay/webhook`, events `payment.captured` and `order.paid`, and put the secret in `RAZORPAY_WEBHOOK_SECRET`.
- Online payments land in **your** Razorpay account. Pay drivers out from there, or apply for Razorpay Route to split payments automatically.
- Live keys (real money) need Razorpay's business verification (KYC).

Riders can still pay the driver directly by UPI, or in cash.

### RideSync Wallet (demo)

With Razorpay keys set, every student gets a **RideSync Wallet** (Wallet tab → **Add money**):

- Add ₹10–₹5,000 through Razorpay (up to ₹10,000 balance), then pay rides from the wallet in one tap. If the balance is short, the app tops up just the difference.
- The fare moves to the driver's wallet straight away. If the ride is cancelled, it goes back to the rider's wallet instantly.
- Test mode shows a **TEST MODE** badge; pay with UPI ID `success@razorpay` or card `4111 1111 1111 1111` (any future expiry, any CVV).

Keep the wallet in **test mode** for demos. Holding students' money for real is a prepaid wallet under RBI rules, which needs RBI authorisation (or a licensed partner). For real money, use **Pay online** instead, where each ride is paid and refunded through Razorpay.

**Demo script:** sign in as a rider → Wallet → Add money ₹200 → pay with `success@razorpay` → book a ride → when the driver accepts, Pay → RideSync Wallet → cancel the ride and show the refund in Wallet activity.

## 3d. Maps

Maps, place search and routes work with **no keys**, using free OpenStreetMap services.

### Google Maps (recommended for the best place search)

One Google key switches on:

- the Google map
- Google place search
- names for "Use current location"
- driving routes with real distances and times

If Google ever fails (wrong key, quota used up, billing off), RideSync quietly switches back to the free services.

1. Go to https://console.cloud.google.com and create a project, e.g. `RideSync`.
2. **Billing → Link a billing account.** Google requires a card even for the free usage. Each API includes a monthly amount of free usage; check https://mapsplatform.google.com/pricing for current limits.
3. **APIs & Services → Library.** Enable these four:
   - **Maps JavaScript API** (the map)
   - **Places API (New)** (search)
   - **Geocoding API** (current-location names)
   - **Routes API** (driving routes)
4. **APIs & Services → Credentials → Create credentials → API key.** Copy the key, which starts with `AIza`.
5. Click the key → **API restrictions → Restrict key**. Tick only the four APIs above and save.
6. Run the setup helper (`setup.bat` / `npm run setup`) and answer **y** to "Set up Google Maps". It checks each API and tells you if one isn't enabled. Or set the key in `.env`:
   ```
   GOOGLE_MAPS_API_KEY=AIza...
   ```
7. Restart. The terminal shows `map: Google · search: Google · routes: Google`.

**Keep costs at zero:**

- Go to **APIs & Services → each API → Quotas** and set a daily cap a little below the free amount. Google then stops answering instead of charging, and RideSync uses the free services for the rest of the day.
- Also add a **budget alert** under Billing → Budgets & alerts, e.g. ₹100.

How RideSync saves on Google usage:

- Searches use **autocomplete sessions**: typing plus the final pick are billed as one lookup.
- Results and routes are cached.
- The popular VIT places in the list don't call Google at all.
- The map is the part used most. To save money, set `GOOGLE_MAPS_DISPLAY=false`: the map stays the free one, while search and routes still use Google.

**When you put RideSync online:** the map key is visible in the browser, which is normal for Google Maps. For extra safety, create a second key restricted to **Websites** → `https://your-site/*` with only Maps JavaScript API, and put it in `GOOGLE_MAPS_BROWSER_KEY`. The main key then stays on the server only.

### Free alternatives

- **MapTiler** (map tiles and place search): sign up at https://cloud.maptiler.com, copy your key, and set `MAPTILER_KEY`.
- **OpenRouteService** (driving routes): sign up at https://openrouteservice.org, request a token, and set `ORS_API_KEY`.

The terminal shows which map services are active when RideSync starts.

### Building names when you drop a pin

When a student drags the pin onto a building, RideSync asks these services in order and uses the first real name it gets. Road names like "NH 48" are skipped.

1. **Google**, if you add a Google key
2. **Ola Maps** (`OLA_MAPS_KEY`): the best for Indian housing societies, towers and gates. Sign up at https://maps.olakrutrim.com, create an app, then paste its API key into setup.bat. It also improves place search.
3. **TomTom nearby places**: colleges, hospitals, malls and shops within 60 m. It uses the same `TOMTOM_KEY` as live traffic.
4. **MapTiler**, then **OpenStreetMap**

If no service knows the building, students tap the **pencil** on the pin screen and type it, e.g. "Shanti Niwas, Gate 2". The map's own name for the spot is kept underneath so the driver can still find it.

The start.bat window shows the order in use, e.g. `pin names: Ola Maps → TomTom places → MapTiler → OpenStreetMap`.

### The map

The website uses a **vector map with 3D buildings**: it stays sharp at every zoom and can be tilted with the **3D** button. With an Ola Maps key it uses **Ola's Indian map style** (local landmarks and societies); otherwise your MapTiler key, or the free OpenFreeMap map. If one can't load, the next is used automatically. If a computer can't show it (old browser, no graphics support), RideSync switches to the simple map automatically.

Trip details are shown **on the map**, like Ola and Uber:

- a time bubble on the route, e.g. "21 min · Light traffic"
- the departure time on the start pin
- the expected arrival time on the destination pin

### Live traffic (free)

Add a free **TomTom** key to get real traffic, like Ola/Uber:

- **Live ETAs:** "Arriving in 7 min" counts current traffic and shows "Heavy traffic · +6 min · live".
- **Google-style route colours:** the route is **blue** where traffic is clear, **orange** where it's slow, **red** where it's heavy and **dark red** at a standstill or closure. The other roads on the map also show traffic colours. Everything refreshes every 2 minutes.
- **Traffic-aware routes:** when a driver offers a ride, the trip time uses expected traffic for that departure time.

How to get the key:

1. Go to https://developer.tomtom.com, click **Register**, and sign up free (no card needed).
2. Open **Dashboard → Keys** and copy the key.
3. Run **setup.bat**, answer `y` to **live traffic**, and paste the key. It shows the current VIT → Dadar time to prove it works.
4. Restart start.bat. You should see `Live traffic (TomTom) works ✓`.

**How trip times are worked out.** Only live traffic data is used. RideSync asks every traffic service you've set up and shows the **slower** answer:

- **TomTom** (live traffic)
- **Ola Maps** (Indian traffic data)
- **Mappls / MapmyIndia** (`MAPPLS_KEY`, free, no card): Indian live traffic; get the REST API key at apis.mappls.com
- **Google** (live traffic), if you add a Google key. Google also colours the route with its own traffic data and gives the closest match to the Google Maps app.

For a rough typical-Mumbai-speed minimum on top of that, add `CITY_SPEED_FLOOR=on` to `.env`.

The free plan includes 2,500 route/ETA requests and 50,000 map tiles a day. RideSync reuses results for 2 minutes to stay within it. Without a key, routes use OSRM, which has no traffic.

## 3e. Android and iPhone apps (Flutter)

The mobile app is a **Flutter** app written in **Dart**, in the `mobile/` folder. It talks to the same server as the website, so app and website users share the same accounts, rides, chats and live updates. It signs in with an email code and keeps its login securely on the phone.

| Part | Package |
|---|---|
| UI | Flutter (Material 3) with RideSync's colours and fonts (`lib/theme.dart`) |
| Server calls | `http`; live updates over Server-Sent Events (`lib/api/`) |
| State | `provider` (`lib/state/session.dart`) |
| Maps | Google Maps (`google_maps_flutter`) when a key is set, otherwise `flutter_map` + OpenStreetMap. In both, the car glides between GPS updates, the route draws itself and the pickup pulses |
| Payments | `razorpay_flutter` (online), UPI app links and QR (`qr_flutter`), cash |
| Sign in with Microsoft | `flutter_web_auth_2` (phone browser → `ridesync://auth` → one-time code swapped for a login) |
| Sharing | `share_plus` |
| GPS | `geolocator` |
| Photos | `image_picker` |
| Login storage | `flutter_secure_storage` |
| UPI, calls, SMS | `url_launcher` |

### Android: get the app

GitHub builds the APK automatically on every update to `main`.

1. On your phone, open **github.com/mastermac123/SB-PROJECT/releases/tag/app-latest** and download **RideSync.apk**. Sign in to GitHub first if the repo is private.
2. Open the file, allow **installing from this source**, then tap **Install**.
3. On first launch the app asks for a **server link**:
   - Testing with your laptop: run `start.bat`, then `share.bat`, and paste the `https://….trycloudflare.com` link.
   - Once RideSync is online: add the repository variable `RIDESYNC_SERVER_URL` = `https://your-server` (GitHub → Settings → Secrets and variables → Actions → Variables). The next build connects automatically.

### Real Google Maps in the app

1. In Google Cloud (the same project as the website key), enable **Maps SDK for Android**. For iPhone, also enable **Maps SDK for iOS**.
2. **Credentials → Create credentials → API key.**
   - Under **Application restrictions**, choose **Android apps**.
   - Add package `com.ridesync.ridesync` with the SHA-1 of the test signing key. To get it, run `keytool -list -v -keystore mobile/android/app/ridesync-test.jks -storepass ridesync-test`.
   - Under **API restrictions**, choose **Maps SDK for Android**.
3. In GitHub, go to **Settings → Secrets and variables → Actions → Secrets → New repository secret**. Set the name to `GOOGLE_MAPS_ANDROID_KEY` and paste the key as the value.
4. The next build uses Google Maps. Without the secret, the app uses the free OpenStreetMap map.

Map loads in the Android app are free within Google's monthly allowance; check current pricing.

### Updating the app

Every build is signed with the same test key (`mobile/android/app/ridesync-test.jks`), so a new APK installs over the old one and you stay logged in. For the Play Store, create your own private upload key; never publish with the test key.

### Build it yourself

Install Flutter (https://docs.flutter.dev/get-started/install) and Android Studio, then:

```bash
cd mobile
flutter pub get
flutter run                                    # on a connected phone or emulator
flutter build apk --dart-define=RIDESYNC_SERVER_URL=https://your-server
```

### iPhone

GitHub builds the iPhone app on a Mac for you (`.github/workflows/ios.yml`) whenever the app code changes. Apple only runs signed apps, so you sign it on your own computer with a free tool:

1. Download **RideSync.ipa** from https://github.com/mastermac123/SB-PROJECT/releases/tag/ios-latest on your **laptop**.
2. Install **iTunes** and **iCloud** from apple.com (not the Microsoft Store versions), then install **Sideloadly** from https://sideloadly.io.
3. Connect the iPhone with a cable, unlock it and tap **Trust**.
4. Open Sideloadly, drag in `RideSync.ipa`, enter your Apple ID and click **Start**. Use a spare Apple ID if you prefer; it's only sent to Apple.
5. On the iPhone: **Settings → Privacy & Security → Developer Mode → On** (it restarts), then **Settings → General → VPN & Device Management →** your Apple ID → **Trust**.
6. Open RideSync and paste the share.bat link, as on Android.

With a free Apple ID the app works for **7 days**; re-install it with Sideloadly to renew. For TestFlight or the App Store you need an **Apple Developer account** ($99/year): on a Mac, run `flutter build ipa` and upload with Transporter.

No laptop handy? Open the website in Safari → **Share** → **Add to Home Screen**. It works like an app.

### What's in the app

- email-code login
- profile and onboarding (photo, phone, student ID, car, UPI)
- home feed of rides leaving soon
- Find a ride with AI matches and "Why this match?"
- ride details and seat requests
- live trip status
- payment by UPI (opens GPay/PhonePe/Paytm) or cash
- the driver's live GPS on the map
- Offer a ride with the suggested cost-share
- driver controls (accept/decline, start, arrived, picked up, dropped off, complete)
- chat, notifications, My Rides, payments
- SOS (112 and a text to your emergency contacts) and ratings

**Still to add for a store release:**

- push notifications while the app is closed (Firebase)
- location sharing with the screen off

## 3f. Phone notifications (Firebase, free)

Ride updates (request accepted, driver on the way, driver arrived, payments, reminders) appear in
the phone's notification bar even when the app is closed, like Ola and Uber. Without this
setup, everything still works, but notifications only show inside the app.

1. Go to **console.firebase.google.com** → **Create a project** → name it `RideSync` (Google Analytics can stay off).
2. **Add app → Android**. Package name: `com.ridesync.ridesync`. Click **Register app** and **download `google-services.json`**. Skip the remaining steps.
3. GitHub → this repository → **Settings → Secrets and variables → Actions → New repository secret**.
   Name: `GOOGLE_SERVICES_JSON`. Value: open `google-services.json` in Notepad, copy everything and paste it.
4. Firebase → ⚙ **Project settings → Service accounts → Generate new private key**. Rename the downloaded file to
   **`firebase-key.json`** and put it in the RideSync folder, next to `.env`. **It's a secret:** never share it or upload it to GitHub (it's git-ignored).
5. Run `start.bat`. It should say `phone notifications: Firebase ✓`.
6. GitHub → **Actions → Android app → Run workflow** (or push any change), then install the new APK. Open the app,
   sign in, and allow notifications when asked.

When you update RideSync from a new ZIP, copy `firebase-key.json` along with `.env` and `data`.
iPhone notifications additionally need an Apple developer account (APNs key); Android works without one.

## 4. Put it online

The app runs as **one server** that serves the website and the API together. The database is a single file, so it needs a persistent disk.

**Render (simplest):** push this repo to GitHub. In Render, choose **New → Blueprint** and pick the repo; `render.yaml` sets everything up, including a 1 GB disk. Enter `PUBLIC_URL`, the Microsoft values and the SMTP values when Render asks. Then add the live callback URL to your Microsoft app's Redirect URIs.

**Any Docker host** (Railway, Fly.io, a VPS):

```bash
docker build -t ridesync .
docker run -p 8787:8787 -v ridesync-data:/data --env-file .env ridesync
```

**Without Docker:** run `npm run build`, then `npm start`, behind HTTPS.

Production must be served over **HTTPS**. Login cookies are marked secure, and phones need HTTPS to share GPS.

---

## How it works

| Step | What happens |
|---|---|
| Sign in | Sign in with Microsoft (VIT Outlook account) or an email code. The server checks the account belongs to VIT's Microsoft directory and the email ends in `@vit.edu.in`, creates the account on first login, and sets a 90-day httpOnly session cookie. |
| Onboarding | Name, mobile number, student ID, commute mode, then car and UPI ID for drivers, then permissions. |
| Offer a Ride | The server gets the road route (Google Routes, or free OSRM), suggests a cost-share and enforces the 1.5× cap. Every online student's search and Home feed refresh straight away. |
| Find a Ride | The server scores every ride with the AI matcher (route overlap, pickup distance, timing, preferences, reliability) and returns explained matches. |
| Book | The rider requests a seat and the driver gets a live notification. The driver accepts or declines, and seats can't be overbooked. |
| Pay | The rider pays the driver directly by **UPI**: the app opens GPay/PhonePe/Paytm with the amount filled in, or shows a QR code on desktop. Riders can also choose **cash at pickup**, or **pay online** when Razorpay is set up. The driver can mark UPI or cash payment as received. |
| Ride | The driver taps Start. Their phone shares GPS every few seconds and riders see the car move on the map. The driver then taps Arrived → Picked up → Dropped off → Complete. |
| After | Both sides rate each other. Ratings, rides offered and taken, completion rate and CO₂ saved are calculated from real trips. |

Also included: chat for each booking, in-app and browser notifications, an SOS sheet (112, plus a text to your emergency contacts with your location), My Rides history, a payment record, and account deletion.

## Project layout

```
server/            Node API (Express + built-in node:sqlite)
  auth.ts            email codes, sessions, domain rule (+ Google)
  microsoft.ts       Sign in with Microsoft (VIT tenant only)
  google.ts          Google Maps: place search, place names, routes
  maps.ts / routing.ts  picks Google or the free map services, with fallback
  routes.ts          rides, matching, bookings, payments, chat, notifications, live location
  db.ts              schema
  events.ts          Server-Sent Events for live updates
src/               React web app
mobile/            Flutter app for Android and iOS (Dart)
  lib/               shared with the server: types, AI matching, geo, validation
  services/api.ts    API client, live-update connection, query cache
  screens/           each product area
docs/              design notes and how matching works
```

## Checks

```bash
npm test          # 53 tests: a full two-account ride, Microsoft sign-in, Razorpay payments, refunds, webhooks and Google Maps
npm run typecheck
```

The tests cover:

- Razorpay: order amount, forged signatures, webhook confirmation, automatic refunds
- Google Maps: search sessions, place details, route decoding, fallback when Google is down
- Microsoft sign-in: wrong college directory, non-college emails, tampered or replayed sign-ins
- domain enforcement and look-alike domains
- the CSRF check
- email codes
- onboarding rules
- privacy (phone and UPI ID hidden until a booking is accepted)
- overbooking
- declines and cancellations
- the full driver ↔ rider lifecycle
