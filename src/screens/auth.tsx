import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, BadgeCheck, CarFront, IndianRupee, Mail, MailCheck, Search, ShieldCheck, Terminal } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import { RouteArt } from '@/components/RouteArt'
import { BackButton } from '@/components/TopBar'
import { Button, Field, Notice, cx } from '@/components/ui'
import { AuthLayout } from '@/layouts/AuthLayout'
import { validateCollegeEmail } from '@/lib/validation'
import { ApiError, auth, useConfig, useMe } from '@/services/api'

/* ==========================================================================
   Splash
   ========================================================================== */

export function Splash() {
  const nav = useNavigate()
  const { user } = useMe()
  const [minDone, setMinDone] = useState(() => sessionStorage.getItem('ridesync:splash') === '1')

  useEffect(() => {
    if (minDone) return
    const t = setTimeout(() => {
      sessionStorage.setItem('ridesync:splash', '1')
      setMinDone(true)
    }, 1900)
    return () => clearTimeout(t)
  }, [minDone])

  useEffect(() => {
    if (!minDone || user === undefined) return
    nav(user ? (user.adminOnly ? '/admin' : user.onboarded ? '/home' : '/onboarding') : '/welcome', { replace: true })
  }, [minDone, user, nav])

  const path = 'M 20 60 C 70 60 80 20 130 20 S 190 50 240 30'
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#fff' }}>
      <div className="stack gap-8" style={{ alignItems: 'center' }}>
        <svg width="260" height="80" viewBox="0 0 260 80" aria-hidden>
          <path d={path} fill="none" stroke="var(--surface-sunken)" strokeWidth="6" strokeLinecap="round" />
          <motion.path d={path} fill="none" stroke="url(#sp)" strokeWidth="6" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: [0.45, 0, 0.2, 1] }} />
          <defs>
            <linearGradient id="sp" x1="0" x2="1">
              <stop offset="0" stopColor="#4365F2" />
              <stop offset="1" stopColor="#6A3EF8" />
            </linearGradient>
          </defs>
          <circle r="7" fill="#fff" stroke="#5038E6" strokeWidth="3">
            <animateMotion dur="1s" fill="freeze" path={path} calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines="0.45 0 0.2 1" />
          </circle>
        </svg>
        <motion.div initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: 0.75, duration: 0.45, ease: [0.2, 0, 0, 1] }}>
          <Logo variant="full" height={72} />
        </motion.div>
      </div>
    </div>
  )
}

/* ==========================================================================
   Landing
   ========================================================================== */

export function Landing() {
  const nav = useNavigate()
  const { user } = useMe()
  const domain = useConfig().data?.allowedDomain ?? 'vit.edu.in'
  if (user) return <Navigate to={user.onboarded ? '/home' : '/onboarding'} replace />
  return (
    <div className="landing">
      <header className="landing__top">
        <Logo height={30} />
      </header>
      <main className="landing__main">
        <div className="landing__art">
          <RouteArt />
        </div>
        <div className="landing__copy">
          <span className="badge badge--verified" style={{ alignSelf: 'flex-start' }}>
            <BadgeCheck />
            Exclusively for Vidyalankar Institute of Technology
          </span>
          <h1 className="t-display landing__title">Smart rides. Shared journeys.</h1>
          <p className="t-body-lg t-secondary landing__lede">Your campus carpool. Every driver and rider is a verified Vidyalankarite.</p>
          <ul className="landing__chips" aria-label="What you can do">
            <li>
              <CarFront /> Offer a ride
            </li>
            <li>
              <Search /> Find a ride
            </li>
            <li>
              <IndianRupee /> Split the cost
            </li>
          </ul>
          <div className="landing__actions">
            <Button size="lg" block onClick={() => nav('/login', { state: { mode: 'signup' } })}>
              Create account
            </Button>
            <Button size="lg" variant="secondary" block onClick={() => nav('/login')}>
              Log in
            </Button>
          </div>
          <p className="t-caption t-muted landing__note">Sign in with your @{domain} email.</p>
          <p className="t-caption t-muted landing__note">
            <Link to="/terms">Terms of Use</Link> · <Link to="/privacy">Privacy Policy</Link>
          </p>
        </div>
      </main>
    </div>
  )
}

/* ==========================================================================
   Google Identity Services
   ========================================================================== */

type GoogleId = {
  accounts: {
    id: {
      initialize: (cfg: Record<string, unknown>) => void
      renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void
    }
  }
}
declare global {
  interface Window {
    google?: GoogleId
  }
}

let gisPromise: Promise<void> | null = null
function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve()
  gisPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      gisPromise = null
      reject(new Error('Couldn’t load Google sign-in'))
    }
    document.head.appendChild(s)
  })
  return gisPromise
}

function GoogleButton({ clientId, domain, onSuccess, onError }: { clientId: string; domain: string; onSuccess: (isNew: boolean, onboarded: boolean) => void; onError: (msg: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    loadGis()
      .then(() => {
        if (!alive || !ref.current) return
        window.google!.accounts.id.initialize({
          client_id: clientId,
          hd: domain, // hint Google to show college accounts; the server enforces the domain
          ux_mode: 'popup',
          auto_select: false,
          callback: async (resp: { credential?: string }) => {
            if (!resp.credential) return onError('Google sign-in was cancelled.')
            setBusy(true)
            try {
              const r = await auth.google(resp.credential)
              onSuccess(r.isNew, r.user.onboarded)
            } catch (e) {
              onError(e instanceof ApiError ? e.message : 'Google sign-in failed. Try again.')
            } finally {
              setBusy(false)
            }
          },
        })
        window.google!.accounts.id.renderButton(ref.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'center',
          width: Math.min(400, ref.current.clientWidth || 360),
        })
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [clientId, domain]) // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return <Notice tone="warning">Google sign-in couldn’t load. Check your connection, or use your college email below.</Notice>
  return (
    <div className="google-slot" aria-busy={busy}>
      <div ref={ref} style={{ width: '100%', display: 'flex', justifyContent: 'center', minHeight: 44, opacity: busy ? 0.5 : 1 }} />
    </div>
  )
}

/* ==========================================================================
   Microsoft (college Outlook / Microsoft 365 accounts)
   ========================================================================== */

function MicrosoftButton({ from }: { from?: string }) {
  const [going, setGoing] = useState(false)
  return (
    <a
      className={cx('ms-btn', going && 'is-loading')}
      href={`/api/auth/microsoft/start${from ? `?from=${encodeURIComponent(from)}` : ''}`}
      onClick={() => setGoing(true)}
      aria-busy={going || undefined}
    >
      <svg width="20" height="20" viewBox="0 0 21 21" aria-hidden>
        <rect x="1" y="1" width="9" height="9" fill="#F25022" />
        <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
        <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
        <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
      </svg>
      {going ? 'Opening Microsoft…' : 'Continue with Microsoft (VIT Outlook)'}
    </a>
  )
}

/* ==========================================================================
   Login / sign up (one flow — accounts are created on first sign-in)
   ========================================================================== */

export function Login() {
  const nav = useNavigate()
  const loc = useLocation()
  const { user } = useMe()
  const config = useConfig()
  const signup = (loc.state as { mode?: string } | null)?.mode === 'signup'
  const from = (loc.state as { from?: string } | null)?.from
  const domain = config.data?.allowedDomain ?? 'vit.edu.in'
  // Signing in for the admin dashboard: the admin email may be outside the college domain (the server checks it).
  const forAdmin = !!from?.startsWith('/admin')

  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(() => new URLSearchParams(loc.search).get('error'))
  const [loading, setLoading] = useState(false)

  if (user) return <Navigate to={forAdmin || user.adminOnly ? from ?? '/admin' : user.onboarded ? from ?? '/home' : '/onboarding'} replace />

  const done = (_isNew: boolean, onboarded: boolean) => nav(forAdmin ? from! : onboarded ? from ?? '/home' : '/onboarding', { replace: true })

  async function sendCode(e?: FormEvent) {
    e?.preventDefault()
    const err = forAdmin ? (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : 'Enter a valid email address') : validateCollegeEmail(email, domain)
    setError(err)
    if (err) return
    setLoading(true)
    setFormError(null)
    try {
      await auth.requestCode(email.trim().toLowerCase())
      setStep('code')
    } catch (ex) {
      if (ex instanceof ApiError && ex.field === 'email') setError(ex.message)
      else setFormError(ex instanceof ApiError ? ex.message : 'Couldn’t send the code.')
    } finally {
      setLoading(false)
    }
  }

  const cfg = config.data
  const sso = !!(cfg?.microsoftLogin || cfg?.googleClientId)
  const switchMode = () => nav('/login', { replace: true, state: { mode: signup ? 'login' : 'signup', from } })
  return (
    <AuthLayout
      top={
        <div className="auth__top">
          {step === 'code' ? (
            <button className="icon-btn" aria-label="Back" onClick={() => setStep('email')}>
              <ArrowRight style={{ transform: 'rotate(180deg)' }} />
            </button>
          ) : (
            <BackButton to={forAdmin ? '/admin' : '/welcome'} />
          )}
          <Logo height={24} className="only-mobile" />
          <span style={{ width: 40 }} className="only-mobile" />
        </div>
      }
    >
      <AnimatePresence mode="wait">
        {step === 'email' ? (
          <motion.div key="email" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            <div className="auth__title">
              <span className="t-overline t-primary">{forAdmin ? 'RideSync Admin' : signup ? 'Join RideSync' : 'Welcome back'}</span>
              <h1 className="t-h1">{forAdmin ? 'Admin sign in' : signup ? 'Create your account' : 'Log in to RideSync'}</h1>
              <p className="t-body t-muted">{forAdmin ? 'For the RideSync admin email only.' : 'Your campus. Your route. Your ride.'}</p>
            </div>
            <div className="stack gap-4">
              {formError && <Notice tone="error">{formError}</Notice>}
              {config.error && <Notice tone="error">Can’t reach RideSync right now. Check your connection and refresh.</Notice>}
              {cfg?.emailLogin && (
                <form className="stack gap-3" onSubmit={sendCode} noValidate>
                  <Field
                    label={forAdmin ? 'Admin email' : 'VIT email'}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoFocus
                    placeholder={forAdmin ? 'admin@example.com' : `firstname.lastname@${domain}`}
                    leading={<Mail />}
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value)
                      if (error) setError(forAdmin ? null : validateCollegeEmail(e.target.value, domain))
                    }}
                    error={error}
                  />
                  <Button type="submit" size="lg" block loading={loading} trailing={<ArrowRight />}>
                    {signup ? 'Create account' : 'Continue'}
                  </Button>
                  <p className="row row--top gap-2 t-caption t-muted" style={{ fontWeight: 400, margin: 0 }}>
                    <ShieldCheck size={14} style={{ flex: 'none', marginTop: 1 }} />
                    No password to remember. We email a 6-digit code to {forAdmin ? 'your admin inbox' : `your @${domain} inbox`} each time you sign in.
                  </p>
                </form>
              )}
              {sso && cfg?.emailLogin && <div className="auth__divider">or</div>}
              {cfg?.microsoftLogin && <MicrosoftButton from={from} />}
              {cfg?.googleClientId && <GoogleButton clientId={cfg.googleClientId} domain={domain} onSuccess={done} onError={setFormError} />}
              {cfg && !cfg.googleClientId && !cfg.microsoftLogin && !cfg.emailLogin && (
                <Notice tone="warning" title="Sign-in isn’t set up yet">
                  The server needs Microsoft sign-in or email settings. See the README.
                </Notice>
              )}
              {cfg?.devLogin && <DevLogin domain={domain} onDone={done} />}
            </div>
            <p className="auth__switch" hidden={forAdmin}>
              {signup ? 'Already on RideSync?' : 'New to RideSync?'}{' '}
              <button type="button" className="link-btn" onClick={switchMode}>
                {signup ? 'Log in' : 'Create account'}
              </button>
            </p>
            <p className="auth__switch t-caption">
              By continuing, you agree to our <Link to="/terms">Terms of Use</Link> and <Link to="/privacy">Privacy Policy</Link>.
            </p>
          </motion.div>
        ) : (
          <motion.div key="code" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.2 }}>
            <CodeStep email={email.trim().toLowerCase()} onDone={done} onResend={() => auth.requestCode(email.trim().toLowerCase())} />
          </motion.div>
        )}
      </AnimatePresence>
    </AuthLayout>
  )
}

function CodeStep({ email, onDone, onResend }: { email: string; onDone: (isNew: boolean, onboarded: boolean) => void; onResend: () => Promise<unknown> }) {
  const inTerminal = useConfig().data?.codesInTerminal
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''))
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(45)
  const [resent, setResent] = useState(false)
  const refs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => refs.current[0]?.focus(), [])

  async function submit(code: string) {
    setLoading(true)
    setError(null)
    try {
      const r = await auth.verifyCode(email, code)
      onDone(r.isNew, r.user.onboarded)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
      setDigits(Array(6).fill(''))
      setTimeout(() => refs.current[0]?.focus(), 0)
    } finally {
      setLoading(false)
    }
  }

  function setAt(i: number, v: string) {
    const clean = v.replace(/\D/g, '')
    if (clean.length > 1) {
      const next = clean.slice(0, 6).split('')
      setDigits([...next, ...Array(6 - next.length).fill('')])
      refs.current[Math.min(5, next.length)]?.focus()
      if (next.length === 6) void submit(next.join(''))
      return
    }
    const next = [...digits]
    next[i] = clean
    setDigits(next)
    setError(null)
    if (clean && i < 5) refs.current[i + 1]?.focus()
    if (next.every(Boolean)) void submit(next.join(''))
  }

  return (
    <>
      <div className="auth__title">
        <div className="state__art" style={{ marginBottom: 8 }}>
          <MailCheck />
        </div>
        <h1 className="t-h1">{inTerminal ? 'Enter your login code' : 'Check your college inbox'}</h1>
        <p className="t-body t-muted">
          {inTerminal ? 'Enter the 6-digit code for ' : 'Enter the 6-digit code we sent to '}
          <strong style={{ color: 'var(--ink-900)' }}>{email}</strong>. It expires in 10 minutes.
        </p>
      </div>
      {inTerminal && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="info" icon={<Terminal />} title="Running on your computer">
            Email sending isn’t set up yet, so the code is shown in the black terminal window where RideSync is running. Add SMTP settings to send real emails.
          </Notice>
        </div>
      )}
      <div className="stack gap-4">
        <div className={cx('otp', error && 'is-invalid')} role="group" aria-label="Login code">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                refs.current[i] = el
              }}
              className="otp__cell"
              inputMode="numeric"
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              maxLength={6}
              value={d}
              aria-label={`Digit ${i + 1}`}
              disabled={loading}
              onChange={(e) => setAt(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus()
              }}
            />
          ))}
        </div>
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <Button size="lg" block loading={loading} disabled={digits.some((d) => !d)} onClick={() => submit(digits.join(''))}>
          Verify and continue
        </Button>
        <Button
          variant="ghost"
          block
          disabled={cooldown > 0}
          onClick={async () => {
            try {
              await onResend()
              setCooldown(45)
              setResent(true)
              setError(null)
            } catch (e) {
              setError(e instanceof ApiError ? e.message : 'Couldn’t resend the code.')
            }
          }}
        >
          {cooldown > 0 ? `Resend code in 0:${String(cooldown).padStart(2, '0')}` : 'Resend code'}
        </Button>
        {resent && <p className="t-sm t-muted t-center">A new code is on its way. Check spam if you don’t see it.</p>}
      </div>
    </>
  )
}

/** Shown only when the server runs with DEV_LOGIN=true (never in production). */
function DevLogin({ domain, onDone }: { domain: string; onDone: (isNew: boolean, onboarded: boolean) => void }) {
  const [email, setEmail] = useState('')
  const [err, setErr] = useState<string | null>(null)
  return (
    <form
      className="dev-login"
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          const r = await auth.dev(email)
          onDone(r.isNew, r.user.onboarded)
        } catch (ex) {
          setErr(ex instanceof ApiError ? ex.message : 'Failed')
        }
      }}
    >
      <span className="row gap-2 t-caption t-muted">
        <Terminal size={13} /> Local development sign-in (disabled in production)
      </span>
      <div className="row gap-2">
        <input className="dev-login__input" placeholder={`test.user@${domain}`} value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Development email" />
        <Button size="sm" variant="secondary" type="submit">
          Sign in
        </Button>
      </div>
      {err && <span className="field__error">{err}</span>}
    </form>
  )
}
