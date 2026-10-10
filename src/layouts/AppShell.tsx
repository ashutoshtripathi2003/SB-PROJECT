import { AnimatePresence, motion } from 'framer-motion'
import { RefreshCw, WifiOff } from 'lucide-react'
import { useEffect } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import { BottomNav, TopNav } from '@/components/Nav'
import { useCelebrate } from '@/components/Celebrate'
import { useToast } from '@/components/Toast'
import { Button, cx } from '@/components/ui'
import { useOnline } from '@/hooks'
import { Assistant } from '@/components/Assistant'
import { connectEvents, onNotification, revalidate, useMe } from '@/services/api'

/** Authenticated shell: top navigation (desktop) / bottom nav (mobile), live updates, toasts. */
export function AppShell({ nav }: { nav: boolean }) {
  const { user, error } = useMe()
  const loc = useLocation()
  const online = useOnline()

  useEffect(() => {
    if (user) connectEvents()
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (online) revalidate()
  }, [online])
  useNotificationToasts()

  if (user === undefined) {
    if (error)
      return (
        <div className="boot">
          <Logo height={28} />
          <p className="t-body t-muted t-center">{error.message}</p>
          <Button variant="secondary" icon={<RefreshCw />} onClick={() => revalidate()}>
            Try again
          </Button>
        </div>
      )
    return (
      <div className="boot" aria-busy>
        <Logo variant="mark" height={44} />
      </div>
    )
  }
  if (user === null) return <Navigate to="/welcome" replace state={{ from: loc.pathname }} />
  if (user.adminOnly) return <Navigate to="/admin" replace />
  if (!user.onboarded && loc.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />
  if (user.onboarded && loc.pathname === '/onboarding') return <Navigate to="/home" replace />

  return (
    <div className={cx('app', nav ? 'app--with-nav' : user.onboarded && 'app--with-topnav')}>
      {user.onboarded && <TopNav />}
      {/* Chat assistant on the main tabs (kept off map screens so it never covers ride controls). */}
      {user.onboarded && nav && <Assistant />}
      <main className="app__main">
        <AnimatePresence>
          {!online && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden', position: 'relative', zIndex: 40 }}>
              <div role="status" className="row gap-2 t-sm" style={{ justifyContent: 'center', padding: '8px 16px', paddingTop: 'calc(8px + var(--safe-top))', background: 'var(--ink-900)', color: '#fff' }}>
                <WifiOff size={15} />
                You’re offline — changes will sync when you reconnect
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <motion.div key={loc.pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}>
          <Outlet />
        </motion.div>
      </main>
      {nav && <BottomNav />}
    </div>
  )
}

/** New notifications from the server → toast (and a system notification when the tab is hidden). */
function useNotificationToasts() {
  const toast = useToast()
  const celebrate = useCelebrate()
  const nav = useNavigate()
  const loc = useLocation()
  useEffect(
    () =>
      onNotification((n) => {
        // The other person acted on your ride: show it as a moment, not just a toast.
        const go = n.link ? { onClick: () => nav(n.link!) } : null
        if (n.kind === 'accepted') return celebrate({ kind: 'accepted', title: 'Ride accepted!', body: `${n.title}. ${n.body}`, action: go ? { label: 'Confirm your seat', ...go } : undefined })
        if (n.kind === 'request') return celebrate({ kind: 'sent', title: 'New ride request', body: n.title, action: go ? { label: 'View request', ...go } : undefined })
        if (n.kind === 'rejected') return celebrate({ kind: 'declined', title: 'Request declined', body: `${n.title}. ${n.body}`, action: { label: 'Find another ride', onClick: () => nav('/find') } })
        if (n.kind === 'cancelled') return celebrate({ kind: 'cancelled', title: n.title, body: n.body, action: go ? { label: 'View details', ...go } : undefined })
        if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            const sys = new Notification(n.title, { body: n.body, icon: '/apple-touch-icon.png', tag: n.id })
            sys.onclick = () => {
              window.focus()
              if (n.link) nav(n.link)
            }
          } catch {
            /* some mobile browsers only allow notifications from a service worker */
          }
        }
        if (n.link && window.location.pathname === n.link) return
        if (n.kind === 'chat' && window.location.pathname.startsWith('/chat/')) return
        toast({
          tone: n.kind === 'payment' ? 'success' : 'info',
          message: n.title,
          action: n.link ? { label: 'View', onClick: () => nav(n.link!) } : undefined,
        })
      }),
    [toast, celebrate, nav, loc.pathname],
  )
}
