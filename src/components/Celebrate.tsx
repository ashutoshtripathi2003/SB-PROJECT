import { AnimatePresence, motion } from 'framer-motion'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { play, type Sound } from '@/lib/sound'

/**
 * Full-screen moments for the actions that matter: ride offered, request sent, ride accepted,
 * seat confirmed, ride started / completed / cancelled. Each kind has its own small animated
 * graphic. Closes by itself (or on tap); "waiting" moments stay until dismissed.
 */

export type CelebrateKind = 'published' | 'sent' | 'accepted' | 'confirmed' | 'started' | 'completed' | 'cancelled' | 'declined'
export type Celebration = { kind: CelebrateKind; title: string; body?: string; action?: { label: string; onClick: () => void }; ms?: number; sound?: Sound }

/** Each moment's sound (src/lib/sound.ts); a moment can ask for another, e.g. a driver's new request. */
const SOUND: Record<CelebrateKind, Sound> = {
  published: 'sent',
  sent: 'sent',
  accepted: 'success',
  confirmed: 'success',
  started: 'start',
  completed: 'success',
  cancelled: 'cancel',
  declined: 'cancel',
}

const Ctx = createContext<(c: Celebration) => void>(() => {})
export const useCelebrate = () => useContext(Ctx)

export function CelebrateProvider({ children }: { children: ReactNode }) {
  const [c, setC] = useState<Celebration | null>(null)
  const timer = useRef<number>(undefined)
  const close = useCallback(() => {
    window.clearTimeout(timer.current)
    setC(null)
  }, [])
  const show = useCallback((next: Celebration) => {
    window.clearTimeout(timer.current)
    setC(next)
    play(next.sound ?? SOUND[next.kind])
    const ms = next.ms ?? (next.action ? 0 : next.kind === 'sent' ? 3200 : 2400)
    if (ms > 0) timer.current = window.setTimeout(() => setC(null), ms)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useEffect(() => {
    if (!c) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [c, close])

  return (
    <Ctx.Provider value={show}>
      {children}
      <AnimatePresence>
        {c && (
          <motion.div key="celebrate" className="celebrate" role="status" aria-live="polite" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onClick={close}>
            <motion.div
              className="celebrate__card"
              onClick={(e) => e.stopPropagation()}
              initial={{ y: 24, scale: 0.96, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 12, scale: 0.98, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            >
              <Art kind={c.kind} />
              <h2 className="t-h2 celebrate__title">{c.title}</h2>
              {c.body && <p className="t-body t-muted celebrate__body">{c.body}</p>}
              {c.kind === 'sent' && <WaitingDots />}
              <div className="celebrate__actions">
                {c.action && (
                  <button
                    type="button"
                    className="btn btn--primary btn--lg btn--block"
                    onClick={() => {
                      close()
                      c.action!.onClick()
                    }}
                  >
                    <span className="btn__label">{c.action.label}</span>
                  </button>
                )}
                <button type="button" className="btn btn--ghost btn--block" onClick={close}>
                  <span className="btn__label">{c.action ? 'Later' : 'Done'}</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Ctx.Provider>
  )
}

function WaitingDots() {
  return (
    <span className="celebrate__dots" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.i key={i} animate={{ opacity: [0.25, 1, 0.25], y: [0, -3, 0] }} transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }} />
      ))}
    </span>
  )
}

const ROUTE = 'M 22 92 C 52 92 52 58 82 54 S 120 30 138 22'
const draw = (delay = 0, duration = 0.7) => ({ initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { delay, duration, ease: [0.45, 0, 0.2, 1] as const } })
const pop = (delay = 0) => ({ initial: { scale: 0, opacity: 0 }, animate: { scale: 1, opacity: 1 }, transition: { delay, type: 'spring' as const, stiffness: 420, damping: 20 } })

/** Small check badge used by several graphics. */
function Check({ x, y, delay, tone = 'var(--success-500)' }: { x: number; y: number; delay: number; tone?: string }) {
  return (
    <motion.g {...pop(delay)} style={{ transformOrigin: `${x}px ${y}px` }}>
      <circle cx={x} cy={y} r="15" fill={tone} />
      <circle cx={x} cy={y} r="15" fill="none" stroke="#fff" strokeWidth="3" />
      <motion.path d={`M ${x - 6} ${y} l 4 4.5 l 8 -9`} fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" {...draw(delay + 0.15, 0.3)} />
    </motion.g>
  )
}

function Car({ path, dur = 1.6, begin = 0.4, repeat = false }: { path: string; dur?: number; begin?: number; repeat?: boolean }) {
  return (
    <g>
      <rect x="-9" y="-5" width="18" height="10" rx="3.5" fill="var(--ink-900)" />
      <rect x="1.5" y="-3.8" width="4.5" height="7.6" rx="1.5" fill="#7fb2ff" />
      <rect x="-6.5" y="-3.8" width="3.5" height="7.6" rx="1" fill="#5e6488" />
      <animateMotion dur={`${dur}s`} begin={`${begin}s`} fill="freeze" repeatCount={repeat ? 'indefinite' : '1'} rotate="auto" path={path} calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines="0.45 0 0.2 1" />
    </g>
  )
}

function Art({ kind }: { kind: CelebrateKind }) {
  const box = { viewBox: '0 0 160 112', className: 'celebrate__art', 'aria-hidden': true } as const
  // Soft confetti for the happy moments.
  const confetti = (
    <g>
      {[
        [30, 30, '#1a73e8'],
        [132, 70, '#f29900'],
        [46, 104, '#14a454'],
        [122, 14, '#5038e6'],
        [16, 62, '#e3242b'],
        [146, 98, '#5038e6'],
      ].map(([x, y, c], i) => (
        <motion.circle key={i} cx={80} cy={56} r="3" fill={c as string} initial={{ cx: 80, cy: 56, opacity: 0 }} animate={{ cx: x as number, cy: y as number, opacity: [0, 1, 0] }} transition={{ delay: 0.75 + i * 0.03, duration: 1.1, ease: 'easeOut' }} />
      ))}
    </g>
  )

  if (kind === 'published' || kind === 'started') {
    return (
      <svg {...box}>
        <path d={ROUTE} fill="none" stroke="var(--surface-sunken)" strokeWidth="10" strokeLinecap="round" />
        <motion.path d={ROUTE} fill="none" stroke="var(--map-route)" strokeWidth="6" strokeLinecap="round" {...draw(0.1, 0.8)} />
        <motion.circle cx="22" cy="92" r="7" fill="var(--ink-900)" stroke="#fff" strokeWidth="3" {...pop(0)} />
        <motion.rect x="131" y="15" width="14" height="14" rx="4" fill="var(--primary-600)" stroke="#fff" strokeWidth="3" {...pop(0.8)} />
        <Car path={ROUTE} begin={kind === 'started' ? 0.2 : 0.5} dur={kind === 'started' ? 2.2 : 1.4} repeat={kind === 'started'} />
        {kind === 'published' && (
          <>
            <Check x={118} y={78} delay={1.5} />
            {confetti}
          </>
        )}
      </svg>
    )
  }
  if (kind === 'sent') {
    return (
      <svg {...box}>
        {[0, 1, 2].map((i) => (
          <motion.circle key={i} cx="80" cy="56" r="20" fill="none" stroke="var(--primary-300)" strokeWidth="2" initial={{ r: 20, opacity: 0.8 }} animate={{ r: 50, opacity: 0 }} transition={{ duration: 2, repeat: Infinity, delay: i * 0.66, ease: 'easeOut' }} />
        ))}
        <motion.circle cx="80" cy="56" r="24" fill="var(--primary-600)" {...pop(0)} />
        <motion.path d="M 70 57 L 91 47 L 84 68 L 80 59 Z" fill="#fff" initial={{ x: -14, y: 10, opacity: 0 }} animate={{ x: 0, y: 0, opacity: 1 }} transition={{ delay: 0.25, duration: 0.45, ease: 'easeOut' }} />
      </svg>
    )
  }
  if (kind === 'accepted') {
    return (
      <svg {...box}>
        <motion.circle cx="42" cy="56" r="20" fill="var(--primary-100)" {...pop(0)} />
        <motion.circle cx="118" cy="56" r="20" fill="var(--secondary-100)" {...pop(0.1)} />
        <motion.path d="M 64 56 L 96 56" stroke="var(--primary-600)" strokeWidth="4" strokeLinecap="round" strokeDasharray="0.1 10" {...draw(0.35, 0.5)} />
        <motion.g {...pop(0.05)} style={{ transformOrigin: '42px 56px' }}>
          <circle cx="42" cy="50" r="7" fill="var(--primary-600)" />
          <path d="M 30 70 C 32 60 52 60 54 70" fill="var(--primary-600)" />
        </motion.g>
        <motion.g {...pop(0.15)} style={{ transformOrigin: '118px 56px' }}>
          <circle cx="118" cy="50" r="7" fill="var(--secondary-500)" />
          <path d="M 106 70 C 108 60 128 60 130 70" fill="var(--secondary-500)" />
        </motion.g>
        <Check x={80} y={56} delay={0.75} />
        {confetti}
      </svg>
    )
  }
  if (kind === 'cancelled' || kind === 'declined') {
    return (
      <svg {...box}>
        <motion.circle cx="80" cy="56" r="32" fill="var(--error-50)" {...pop(0)} />
        <motion.circle cx="80" cy="56" r="24" fill="none" stroke="var(--error-500)" strokeWidth="4" {...draw(0.1, 0.5)} />
        <motion.path d="M 71 47 L 89 65 M 89 47 L 71 65" stroke="var(--error-500)" strokeWidth="4" strokeLinecap="round" {...draw(0.45, 0.3)} />
      </svg>
    )
  }
  // confirmed / completed
  return (
    <svg {...box}>
      <motion.circle cx="80" cy="56" r="34" fill="var(--success-50)" {...pop(0)} />
      <motion.circle cx="80" cy="56" r="26" fill="none" stroke="var(--success-500)" strokeWidth="4" {...draw(0.1, 0.5)} />
      <motion.path d="M 68 57 L 77 66 L 93 48" fill="none" stroke="var(--success-500)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" {...draw(0.5, 0.35)} />
      {kind === 'completed' && (
        <motion.g {...pop(0.9)} style={{ transformOrigin: '116px 30px' }}>
          <path d="M 110 42 L 110 18" stroke="var(--ink-900)" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M 110 18 L 128 22 L 110 28 Z" fill="var(--primary-600)" />
        </motion.g>
      )}
      {confetti}
    </svg>
  )
}
