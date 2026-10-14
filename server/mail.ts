import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import nodemailer, { type Transporter } from 'nodemailer'
import { env, smtpBackupConfigured, smtpConfigured } from './env'
import { HttpError } from './logic'

/**
 * Login-code email with automatic failover.
 *
 * Senders are tried in order (main, then backup). When one reports that its
 * daily sending limit is used up (Gmail ~500/day, Brevo free 300/day…), it is
 * paused until the next day and the next sender takes over. With Gmail + a
 * free Brevo account that's ~800 codes a day for free.
 */

type Sender = { name: string; from: string; transport: Transporter; pausedUntil: number; sentToday: number; day: string }

const make = (name: string, c: typeof env.smtp): Sender => ({
  name,
  from: c.from,
  transport: nodemailer.createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass }, pool: true, maxConnections: 3 }),
  pausedUntil: 0,
  sentToday: 0,
  day: '',
})

const senders: Sender[] = [...(smtpConfigured() ? [make(`main (${env.smtp.user})`, env.smtp)] : []), ...(smtpBackupConfigured() ? [make(`backup (${env.smtpBackup.user})`, env.smtpBackup)] : [])]

export const mailConfigured = () => senders.length > 0

const today = () => new Date().toISOString().slice(0, 10)
const tomorrow = () => {
  const d = new Date()
  d.setHours(24, 5, 0, 0)
  return d.getTime()
}

/** Errors that mean "this account can't send more today" rather than "this address is bad". */
const isQuotaError = (e: unknown) =>
  /5\.4\.5|daily (user )?sending (quota|limit)|quota|rate limit|too many|4\.7\.0|454|421|550 5\.4\.5|limit exceeded/i.test(String((e as Error)?.message ?? e))
const isAuthError = (e: unknown) => /535|534|auth|credentials|password/i.test(String((e as Error)?.message ?? e))

function message(email: string, code: string) {
  return {
    to: email,
    subject: `${code} is your RideSync login code`,
    text: `Your RideSync login code is ${code}.\n\nIt expires in 10 minutes. If you didn’t try to log in, you can ignore this email.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:auto;padding:24px;color:#15182E">
      <p style="font-size:15px">Your RideSync login code is</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:12px 0">${code}</p>
      <p style="font-size:13px;color:#64677E">It expires in 10 minutes. If you didn’t try to log in, you can ignore this email.</p>
    </div>`,
  }
}

/** The admin switch on the live server: while this file exists, login codes are also printed in the server log. */
export const loginCodeSwitch = () => join(dirname(env.databasePath), 'show-login-codes')

/**
 * Whether the server log shows the login code next to "login code emailed to …" (handy when Outlook delays it).
 * On your own laptop: yes, unless SHOW_LOGIN_CODES=false. Online: only while the admin switch file exists
 * (`sudo touch /opt/ridesync/data/show-login-codes`; remove it to stop). Reading the log needs the server's SSH key.
 */
export function showLoginCodes(prod = env.isProd, switchFile = loginCodeSwitch()) {
  return prod ? existsSync(switchFile) : process.env.SHOW_LOGIN_CODES !== 'false'
}

export async function sendLoginCode(email: string, code: string) {
  if (!senders.length) {
    // Development without SMTP: print to the server console only.
    console.log(`\n  ┌──────────────────────────────────────────────\n  │ RideSync login code for ${email}\n  │\n  │      ${code}\n  │\n  │ (shown here because email isn’t set up yet)\n  └──────────────────────────────────────────────\n`)
    return
  }
  let lastError: unknown
  for (const s of senders) {
    if (Date.now() < s.pausedUntil) continue
    try {
      await s.transport.sendMail({ from: s.from, ...message(email, code) })
      if (s.day !== today()) {
        s.day = today()
        s.sentToday = 0
      }
      s.sentToday++
      if (process.env.NODE_ENV !== 'test') {
        const show = showLoginCodes()
        console.log(`[ridesync] login code emailed to ${email}${show ? ` — code ${code}` : ''} (from ${s.from}) — if it doesn't arrive, check Junk/Quarantine in Outlook`)
      }
      return
    } catch (e) {
      lastError = e
      if (isQuotaError(e)) {
        s.pausedUntil = tomorrow()
        console.error(`[ridesync] email sender ${s.name} reached its limit after ${s.sentToday} today — switching to the next sender`)
      } else if (isAuthError(e)) {
        s.pausedUntil = Date.now() + 10 * 60_000
        console.error(`[ridesync] email sender ${s.name} login failed — run setup.bat to fix it. (${(e as Error).message})`)
      } else {
        console.error(`[ridesync] email sender ${s.name} failed: ${(e as Error).message}`)
      }
    }
  }
  console.error('[ridesync] no email sender could deliver a login code', (lastError as Error)?.message)
  throw new HttpError(503, 'Login emails are busy right now. Please try again in a while, or use “Sign in with Microsoft”.')
}

/** Status for the startup log. */
export function mailStatus() {
  return senders.map((s) => ({ name: s.name, paused: Date.now() < s.pausedUntil, sentToday: s.day === today() ? s.sentToday : 0 }))
}

/** Check SMTP logins at startup so problems show up in the terminal, not at a student's first login. */
export async function verifyMail() {
  for (const s of senders) {
    try {
      await s.transport.verify()
      console.log(`[ridesync] email ready — ${s.name} sends as ${s.from}`)
    } catch (e) {
      console.error(`[ridesync] EMAIL NOT WORKING for ${s.name}: ${(e as Error).message}\n           Run "npm run setup" (or setup.bat) to fix your email settings.`)
    }
  }
}

/** Tests only. */
export const __senders = senders
