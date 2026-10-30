/** Server configuration — all from environment variables. See .env.example. */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Where settings came from, for the startup message. */
export const envFile = { path: resolve('.env'), found: existsSync('.env'), error: '' }

// Load .env when present (values already set in the environment win).
// If Node's strict parser rejects the file, read it line by line instead of silently ignoring it.
if (envFile.found) {
  try {
    process.loadEnvFile('.env')
  } catch (e) {
    envFile.error = (e as Error).message
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"')
    }
  }
}
process.env.TZ = process.env.TZ || 'Asia/Kolkata'

const bool = (v: string | undefined) => v === '1' || v === 'true'

export const env = {
  port: Number(process.env.PORT || 8787),
  isProd: process.env.NODE_ENV === 'production',
  /** Only emails at this domain may sign in. */
  allowedDomain: (process.env.ALLOWED_EMAIL_DOMAIN || 'vit.edu.in').toLowerCase(),
  databasePath: process.env.DATABASE_PATH || './data/ridesync.db',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  /** "Sign in with Microsoft" — for colleges on Microsoft 365 / Outlook. */
  microsoft: {
    clientId: process.env.MICROSOFT_CLIENT_ID || '',
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
    /** Optional: pin the college's Microsoft tenant ID. Looked up from the domain when empty. */
    tenantId: process.env.MICROSOFT_TENANT_ID || '',
  },
  /** Backup sender used automatically when the main one hits its daily limit (e.g. Brevo free 300/day). */
  smtpBackup: {
    host: process.env.SMTP2_HOST || '',
    port: Number(process.env.SMTP2_PORT || 587),
    user: process.env.SMTP2_USER || '',
    pass: process.env.SMTP2_PASS || '',
    from: process.env.MAIL2_FROM || process.env.MAIL_FROM || '',
  },
  /** How long a login lasts on a device, in days. */
  sessionDays: Number(process.env.SESSION_DAYS || 90),
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || '',
  },
  osrmUrl: process.env.OSRM_URL || 'https://router.project-osrm.org',
  /** Optional: OpenRouteService key for driving routes (free at openrouteservice.org). */
  orsKey: process.env.ORS_API_KEY || '',
  /** Optional: MapTiler key for map tiles + place search (free at maptiler.com). */
  maptilerKey: process.env.MAPTILER_KEY || '',
  /** Optional: TomTom key for live traffic in routes, ETAs and the map (free at developer.tomtom.com). */
  tomtomKey: (process.env.TOMTOM_KEY || '').trim(),
  /** Optional: Ola Maps key for Indian building/society names and search (maps.olakrutrim.com). */
  olaKey: (process.env.OLA_MAPS_KEY || '').trim(),
  /** Optional: Ola Maps OAuth client credentials (instead of the API key). */
  olaClientId: (process.env.OLA_CLIENT_ID || '').trim(),
  olaClientSecret: (process.env.OLA_CLIENT_SECRET || '').trim(),
  /** Optional: Mappls (MapmyIndia) REST key for live Indian traffic in trip times (apis.mappls.com). */
  mapplsKey: (process.env.MAPPLS_KEY || '').trim(),
  /** Optional: Mappls OAuth client credentials (newer accounts) instead of / as well as the static key. */
  mapplsClientId: (process.env.MAPPLS_CLIENT_ID || '').trim(),
  mapplsClientSecret: (process.env.MAPPLS_CLIENT_SECRET || '').trim(),
  /**
   * Optional: Google Maps Platform. One key turns on Google place search, place names
   * and driving routes (server side) and the Google map (browser side).
   */
  google: {
    key: process.env.GOOGLE_MAPS_API_KEY || '',
    /** Separate key restricted to your website, for the map shown in the browser. Defaults to the key above. */
    browserKey: process.env.GOOGLE_MAPS_BROWSER_KEY || process.env.GOOGLE_MAPS_API_KEY || '',
    /** Set to false to keep the free OpenStreetMap map while still using Google search and routes. */
    display: process.env.GOOGLE_MAPS_DISPLAY ? bool(process.env.GOOGLE_MAPS_DISPLAY) : !bool(process.env.GOOGLE_ROUTES_ONLY),
    /** Use Google only for trip times (traffic) — map, search and names stay on the free services. Keeps usage tiny. */
    routesOnly: bool(process.env.GOOGLE_ROUTES_ONLY),
  },
  /** Optional: Razorpay payment gateway (test keys start with rzp_test_). */
  razorpay: {
    keyId: (process.env.RAZORPAY_KEY_ID || '').trim(),
    keySecret: (process.env.RAZORPAY_KEY_SECRET || '').trim(),
    webhookSecret: (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim(),
  },
  /** Local development only: sign in without Google/email. Refused in production. */
  devLogin: bool(process.env.DEV_LOGIN) && process.env.NODE_ENV !== 'production',
  /** Public address of the site, e.g. https://ridesync.onrender.com (used for sign-in redirects). */
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  /** Emails that can approve student ID cards (comma-separated). */
  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  /** Shown in the Privacy Policy and Terms as the contact / grievance address. */
  supportEmail: (process.env.SUPPORT_EMAIL || '').trim(),
  /** Where the Android app is built (GitHub releases), for the /download page. */
  githubRepo: (process.env.GITHUB_REPO || 'ashutoshtripathi2003/SB-PROJECT').trim(),
  /** Needed once the repository is private: a read-only GitHub token (Contents: read) for that repository. */
  githubToken: (process.env.GITHUB_TOKEN || '').trim(),
}

export const smtpConfigured = () => !!(env.smtp.host && env.smtp.user && env.smtp.pass && env.smtp.from)
export const smtpBackupConfigured = () => !!(env.smtpBackup.host && env.smtpBackup.user && env.smtpBackup.pass && env.smtpBackup.from)

export const microsoftConfigured = () => !!(env.microsoft.clientId && env.microsoft.clientSecret)
export const razorpayConfigured = () => !!(env.razorpay.keyId && env.razorpay.keySecret)
export const anyMailConfigured = () => smtpConfigured() || smtpBackupConfigured()
