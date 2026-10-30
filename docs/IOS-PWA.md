# RideSync AI on iPhone (installable web app)

There is no App Store build: an iOS app needs a Mac, Xcode and a paid Apple Developer account (US$99 a year).
Instead, iPhone users install the website as an app (a PWA). It opens full screen from the Home Screen with
the RideSync icon, like any app, and always runs the latest version — no updates to install.

## How students install it

1. Open **https://ridesync-vit.duckdns.org** in **Safari** (Chrome on iPhone can also do it on iOS 16.4+).
2. Tap **Share** (the square with an arrow) → **Add to Home Screen** → **Add**.
3. Open RideSync from the Home Screen and sign in with the college email.

The website shows these steps itself on iPhone (a card on the welcome and home screens, which can be closed).
An app on the Home Screen keeps its own sign-in, separate from Safari, so students sign in once inside it.

## What makes it work

| Part | File |
|---|---|
| App name, icons, full-screen mode, shortcuts | `public/manifest.webmanifest`, `public/icon-*.png` |
| iPhone full-screen and Home Screen title | `index.html` (`apple-mobile-web-app-*` tags) |
| Fast start and an offline shell; live data (`/api/`, maps, payments) always from the network | `public/sw.js`, registered in `src/main.tsx` |
| The "Install the RideSync app" card | `src/components/InstallHint.tsx` |
| The service worker and manifest are never cached by the browser, so a deploy reaches phones at once | `server/app.ts` |

After `update.sh` on the server, installed apps pick up the new version the next time they are opened.

## Limits compared with a native iPhone app

* Push notifications: the Android app uses Firebase. iPhone web push needs extra work (Web Push with VAPID keys)
  and is not added yet, so iPhone users see notifications inside the app, not on the lock screen.
* Live location is shared only while the app is open on screen (iOS pauses web apps in the background).
* It is not listed in the App Store.
