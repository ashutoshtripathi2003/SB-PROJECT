# RideSync AI — Google Play launch kit

Everything needed to publish the Android app. Graphics are in `graphics/`.

## 1. Store listing (copy and paste)

**App name** (30 max): `RideSync AI: Campus Carpool`

**Short description** (80 max):
`Carpool with verified VIT students. Same direction, shared ride, fair fuel split.`

**Full description** (4000 max):

```
RideSync AI is a carpooling app only for verified students of Vidyalankar Institute of Technology (VIT), Mumbai.

Many of us travel the same road to college every day — some pay for a cab or auto alone, others drive with empty seats. RideSync connects them: drivers offer the seats they already have, riders going the same way book a seat, and everyone shares the fuel cost.

ONLY VERIFIED STUDENTS
• Sign in with your @vit.edu.in college email and a one-time code — no passwords.
• Optional student ID card check for a "Verified" badge.

RIDES THAT REALLY FIT YOUR ROUTE
• Smart matching checks the driver's real road route, your pickup and drop, timing and preferences.
• "Why this match?" shows exactly how every ride is scored.
• Live traffic-aware trip times.

A FAIR PRICE, NO PLATFORM FEE
• The suggested price per seat comes from the distance and the real petrol price.
• Drivers can adjust it within limits. Minimum ₹30 a seat.
• Pay the driver directly by UPI, cash, wallet or online payment.

SAFETY BUILT IN
• 4-digit ride PIN checked before every trip starts.
• Share your live trip on WhatsApp.
• Off-route alerts and an SOS button.
• Women-only rides, offered by female drivers.

MORE
• Chat with your driver or rider.
• Live car tracking during the trip.
• RideSync Assistant understands English and Hinglish ("kal 9 baje Andheri jana hai").

RideSync is a student-built, cost-sharing platform — not a taxi service.
Privacy Policy: https://ridesync-vit.duckdns.org/privacy
```

**Category:** Travel & Local  
**Tags:** Carpool, Ride sharing, Travel  
**Contact email:** the same address as `SUPPORT_EMAIL` on the server  
**Website:** https://ridesync-vit.duckdns.org  
**Privacy policy URL:** https://ridesync-vit.duckdns.org/privacy

**Graphics** (`graphics/`):

| Play Console field | File |
|---|---|
| App icon (512 × 512) | `icon-512.png` |
| Feature graphic (1024 × 500) | `feature-graphic-1024x500.png` |
| Phone screenshots (1080 × 1920, 2–8 needed) | `screenshot-1.png` … `screenshot-6.png` |

The screenshots were taken without map tiles (grey background). For the best listing, replace them with
screenshots from a real phone at the same size (1080 × 1920).

## 2. App content (Play Console → Policy → App content)

| Section | Answer |
|---|---|
| Privacy policy | https://ridesync-vit.duckdns.org/privacy |
| Ads | No, the app does not contain ads |
| App access | Restricted — needs sign-in. Give reviewers working instructions (see section 4) |
| Content rating | Fill in the IARC questionnaire: category *Utility, Productivity, Communication or Other*; users can interact/chat with each other: **Yes**; shares the user's location with other users: **Yes**; no violence, sexual content, gambling or drugs |
| Target audience | 18 and over |
| News app | No |
| Government app | No |
| Financial features | None (payments for a real-world service; not a lender, bank or wallet provider) |
| Health | No |
| Data safety | See section 3 |
| Account deletion URL | https://ridesync-vit.duckdns.org/delete-account |

## 3. Data safety form

**Does the app collect or share user data?** Yes, it collects. It does **not share** data (the providers listed
in the Privacy Policy process data on our behalf, which Google does not count as sharing).

**Is all data encrypted in transit?** Yes (HTTPS).  
**Can users request deletion?** Yes — in the app (Profile → Delete account) and at the account deletion URL.

| Data type (Play's names) | Collected | Required or optional | Purposes |
|---|---|---|---|
| Personal info → Name | Yes | Required | App functionality, Account management |
| Personal info → Email address | Yes | Required | App functionality, Account management, Fraud prevention & security |
| Personal info → Phone number | Yes | Required | App functionality, Account management |
| Personal info → User IDs (student ID) | Yes | Required | Account management, Fraud prevention & security |
| Personal info → Other info (gender, programme, emergency contacts, usual way to college, car details and mileage) | Yes | Optional | App functionality |
| Location → Precise location | Yes | Optional (permission) | App functionality (live trip, pickup) |
| Location → Approximate location | Yes | Optional (permission) | App functionality |
| Financial info → User payment info (UPI ID) | Yes | Optional | App functionality |
| Financial info → Purchase history (ride payments) | Yes | Required for bookings | App functionality |
| Messages → Other in-app messages | Yes | Optional | App functionality |
| Photos and videos → Photos (profile photo, college ID card) | Yes | Optional | App functionality, Fraud prevention & security |
| App activity → Other actions (rides, bookings, ratings) | Yes | Required | App functionality, Analytics (our own models) |
| Device or other IDs (notification token) | Yes | Optional | App functionality |

None of the data is processed only on the device; none is collected for advertising.

## 4. Reviewer access (needed before review)

Google's reviewers can't receive a code at a @vit.edu.in inbox. Choose one before submitting:

1. **Review account switch (needs a small code change, not yet added):** one email set in the server's `.env`
   signs in with a fixed 6-digit code, only while the setting is present. Remove it after approval.
2. **Admin "show login codes" switch:** turn on `show-login-codes`, give the reviewer a test email address on the
   allowed domain, and read the code from the server log when they sign in. This only works if someone is
   watching the log during review, so option 1 is more reliable.

In Play Console → App content → App access, give the email address, the code (or "the code is sent instantly"),
and short steps: "Sign in → complete profile with any test details → Find ride".

## 5. Release signing (one-time)

The Play Store build must be signed with a **private upload key** (never the test key committed in the repo).

1. Keep the upload key file (`ridesync-upload.jks`) and its password somewhere safe (e.g. your private Google Drive
   and a pen drive). If it is lost, Google can reset the upload key, but it takes days.
2. GitHub → repository → **Settings → Secrets and variables → Actions → New repository secret**:
   * `RIDESYNC_UPLOAD_KEYSTORE_B64` — the base64 text of the key file
   * `RIDESYNC_UPLOAD_PASSWORD` — its password
3. Push to `main` (or run the *Android app* workflow by hand). The run's artifacts then include
   **RideSync-play-store-bundle → RideSync.aab**.
4. In Play Console, accept **Play App Signing** (Google keeps the final app-signing key; ours is only for uploading).

The APKs on GitHub stay on the test key, so phones that installed them can keep updating. A phone can't switch from
the GitHub APK to the Play Store version without uninstalling it first (different signatures).

## 6. Launch steps

1. Create a Google Play developer account (personal, US$25 one-time) and verify your identity.
2. Create the app: name, default language English (India), App, Free.
3. Fill in **App content** (section 2) and **Data safety** (section 3).
4. Fill in the **Store listing** (section 1) and upload the graphics.
5. **Testing → Closed testing:** create a track, upload `RideSync.aab`, add at least **12 testers** (their Gmail
   addresses) and share the opt-in link. New personal accounts must keep **12+ testers opted in for 14 days in a
   row** before production access.
6. After 14 days, apply for production access, then **Production → Create release** with the latest AAB.
7. Every new release needs a higher version code — the GitHub workflow uses the run number, so just use the
   newest build.
