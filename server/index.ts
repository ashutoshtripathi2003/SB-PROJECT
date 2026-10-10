import { createApp, env } from './app'
import { verifyMail } from './mail'
import { checkMapTiler } from './maps'
import { checkTomTom } from './traffic'
import { checkMappls } from './mappls'
import { razorpayConfigured } from './env'
import { checkRazorpay } from './razorpay'
import { sendRideReminders } from './routes'
import { trainAll } from './ml/models'
import { microsoftConfigured, anyMailConfigured, envFile } from './env'
import { checkBasemap } from './basemap'
import { pushConfigured, pushProject } from './push'

const app = createApp()
// Machine-learning models: train shortly after start-up, then every 30 minutes on new data.
setTimeout(trainAll, 3000)
setInterval(trainAll, 30 * 60_000)
// 15-minute ride reminders.
setInterval(() => {
  try {
    sendRideReminders()
  } catch (e) {
    console.error('[ridesync] reminders failed', (e as Error).message)
  }
}, 60_000)
const server = app.listen(env.port, () => {
  console.log(`[ridesync] API listening on http://localhost:${env.port}`)
  console.log(envFile.found ? `[ridesync] settings: ${envFile.path}` : `[ridesync] ⚠ No settings file (.env) in ${process.cwd()} — run setup.bat in THIS folder to set up email, payments and maps.`)
  if (envFile.error) console.log(`[ridesync] ⚠ .env has a formatting problem (${envFile.error}) — read it line by line instead. Run setup.bat again to rewrite it.`)
  console.log(`[ridesync] sign-in restricted to @${env.allowedDomain}`)
  if (!microsoftConfigured()) console.log('[ridesync] Microsoft sign-in not set up yet — see README section 2 (email codes still work)')
  if (!anyMailConfigured()) {
    const missing = (['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'] as const).filter((k) => !process.env[k])
    console.log(env.isProd ? '[ridesync] SMTP not set — email-code login disabled' : '[ridesync] SMTP not set — login codes are printed here (dev only)')
    if (envFile.found) console.log(`[ridesync] ⚠ Email is off because .env is missing: ${missing.join(', ')}. Run setup.bat, answer y to the email question and enter the Gmail App Password.`)
  }
  if (anyMailConfigured()) void verifyMail()
  console.log(env.adminEmails.length ? `[ridesync] ID card approvals: ${env.adminEmails.join(', ')} — admin dashboard at /admin` : '[ridesync] ID card approvals: no admin yet — run setup.bat and answer y to the admin question')
  console.log(razorpayConfigured() ? `[ridesync] Razorpay ${env.razorpay.keyId.startsWith('rzp_test_') ? 'TEST' : 'LIVE'} mode enabled` : '[ridesync] ⚠ Razorpay not set — Wallet "Add money" and online payment are off. Run setup.bat, answer y to Razorpay and paste your Key Id + Key Secret.')
  void checkRazorpay().then((r) => {
    if (r === 'ok') console.log('[ridesync] Razorpay keys work ✓ (Wallet and online payment ready)')
    if (r === 'rejected') console.log('[ridesync] ⚠ Razorpay rejected the keys in .env — Wallet "Add money" will fail. In dashboard.razorpay.com (Test mode) → Account & Settings → API Keys → Regenerate, then run setup.bat.')
    if (r === 'offline') console.log('[ridesync] ⚠ Couldn’t reach Razorpay to check the keys (internet?).')
  })
  void checkMapTiler().then((r) => {
    if (r === 'rejected') console.log('[ridesync] ⚠ MapTiler rejected the key in .env (MAPTILER_KEY) — using the free OpenStreetMap map instead. Copy the key again from cloud.maptiler.com → API keys and run setup.bat.')
    if (r === 'ok') console.log('[ridesync] MapTiler key works ✓')
  })
  void checkMappls().then((r) => {
    if (r) console.log(`[ridesync] Mappls live traffic works ✓ (${r})`)
    else if (r === '') console.log('[ridesync] ⚠ Mappls didn’t accept MAPPLS_KEY for routing — copy the REST API key again from apis.mappls.com and run setup.bat (trip times still use TomTom/Ola).')
  })
  void checkTomTom().then((r) => {
    if (r === 'ok') console.log('[ridesync] Live traffic (TomTom) works ✓')
    if (r === 'rejected') console.log('[ridesync] ⚠ TomTom rejected TOMTOM_KEY — routes use OSRM without live traffic. Copy the key again from developer.tomtom.com and run setup.bat.')
    if (r === 'none') console.log('[ridesync] Live traffic off — add a free TomTom key with setup.bat (see README "Live traffic")')
  })
  console.log(`[ridesync] trip times (live traffic): ${[env.google.key && 'Google', env.tomtomKey && 'TomTom', (env.olaKey || env.olaClientId) && 'Ola Maps', (env.mapplsKey || env.mapplsClientId) && 'Mappls'].filter(Boolean).join(' + ') || 'none — add a TomTom, Ola Maps or Mappls key with setup.bat'}${process.env.CITY_SPEED_FLOOR !== 'off' && !env.google.key ? ' + Mumbai rush-hour correction (learns from completed trips)' : ''}`)
  console.log(`[ridesync] pin names: ${[env.google.key && 'Google', (env.olaKey || env.olaClientId) && 'Ola Maps', env.tomtomKey && 'TomTom places', env.maptilerKey && 'MapTiler', 'OpenStreetMap'].filter(Boolean).join(' → ')}`)
  const g = !!env.google.key && !env.google.routesOnly
  console.log(
    `[ridesync] map: ${g && env.google.display ? 'Google' : env.maptilerKey ? 'MapTiler' : 'OpenStreetMap/CARTO'} · search: ${g ? 'Google' : env.maptilerKey ? 'MapTiler' : 'OpenStreetMap'} · routes: ${env.google.key ? 'Google (live traffic)' : env.tomtomKey ? 'TomTom (live traffic)' : env.orsKey ? 'OpenRouteService' : 'OSRM'}`,
  )
  console.log(pushConfigured() ? `[ridesync] phone notifications: Firebase ✓ (project ${pushProject()})` : '[ridesync] phone notifications: off — add firebase-key.json to this folder (see README › Phone notifications)')
  void checkBasemap().then((r) => console.log(`[ridesync] phone app map check: ${r}${r.includes('✓') ? '' : '  ⚠ NO MAP SERVICE WORKS — the app map will be blank. Check TOMTOM_KEY (developer.tomtom.com → your app → Map Display API must be on) and the laptop’s internet.'}`))
  if (env.devLogin) console.log('[ridesync] DEV_LOGIN enabled (local development only)')
})

// An older RideSync left running in another window keeps the port, and the website/app
// would silently talk to that old copy (old code, old settings). Say so loudly.
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code !== 'EADDRINUSE') throw e
  console.log(`
  ┌──────────────────────────────────────────────────────────────────
  │ ⚠ RideSync is ALREADY RUNNING somewhere else (port ${env.port} is taken).
  │   The website and app are talking to that OLD copy, not this one.
  │
  │   Fix: close this window, then in Command Prompt run
  │        taskkill /F /IM node.exe
  │   and double-click start.bat again.
  └──────────────────────────────────────────────────────────────────
`)
  process.exit(1)
})
