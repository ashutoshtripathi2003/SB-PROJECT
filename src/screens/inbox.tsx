import { Bell, BellOff, CarFront, ChevronRight, CircleCheck, CircleX, CreditCard, Lock, MessageCircle, Navigation, Phone, Send, Sparkle, UserPlus } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { StateView } from '@/components/States'
import { BackButton } from '@/components/TopBar'
import { Avatar, Badge, Button, IconButton, Notice, cx } from '@/components/ui'
import { dayLabel, dayTime, firstName, relative, time } from '@/lib/format'
import type { AppNotification, Message, NotificationKind, Thread } from '@/lib/types'
import { Page } from '@/layouts/Page'
import { ApiError, Q, bookings, notificationPermission, notifications, requestNotificationPermission, useMe, useQuery, type BookingDetail } from '@/services/api'
import { useToast } from '@/components/Toast'
import { RideCardSkeleton } from '@/components/ui'
import { BOOKING_STATUS } from './trip'

const KIND_ICON: Record<NotificationKind, React.ReactNode> = {
  request: <UserPlus />,
  accepted: <CircleCheck />,
  rejected: <CircleX />,
  cancelled: <CircleX />,
  payment: <CreditCard />,
  arriving: <Navigation />,
  match: <Sparkle />,
  system: <Bell />,
  chat: <MessageCircle />,
}

/** Notification filters, like Uber's inbox: chat messages live in the Messages tab instead. */
const FILTERS: { key: string; label: string; kinds: NotificationKind[] }[] = [
  { key: 'all', label: 'All', kinds: ['request', 'accepted', 'rejected', 'cancelled', 'payment', 'arriving', 'match', 'system'] },
  { key: 'rides', label: 'Rides', kinds: ['request', 'accepted', 'rejected', 'cancelled', 'arriving', 'match'] },
  { key: 'payments', label: 'Payments', kinds: ['payment'] },
  { key: 'updates', label: 'Updates', kinds: ['system'] },
]

const ENDED = ['completed', 'cancelled', 'rejected']

/* ==========================================================================
   Inbox: Messages and Notifications in one place (Uber / Rapido style)
   ========================================================================== */

export const Notifications = () => <Inbox tab="notifications" />
export const ChatList = () => <Inbox tab="messages" />

export function Inbox({ tab = 'messages' }: { tab?: 'messages' | 'notifications' }) {
  const nav = useNavigate()
  const threads = useQuery<Thread[]>(Q.threads)
  const notes = useQuery<AppNotification[]>(Q.notifications)
  const unreadChats = (threads.data ?? []).reduce((s, t) => s + (t.unread ?? 0), 0)
  const unreadNotes = (notes.data ?? []).filter((n) => !n.read && n.kind !== 'chat').length
  return (
    <Page title="Inbox">
      <div className="inbox-tabs" role="tablist" aria-label="Inbox">
        {(
          [
            ['messages', 'Messages', unreadChats, '/chat'],
            ['notifications', 'Notifications', unreadNotes, '/notifications'],
          ] as const
        ).map(([key, label, count, to]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={cx('inbox-tabs__tab', tab === key && 'is-active')} onClick={() => nav(to, { replace: true })}>
            {label}
            {count > 0 && <span className="count-badge">{count > 9 ? '9+' : count}</span>}
          </button>
        ))}
      </div>
      {tab === 'messages' ? <MessagesTab q={threads} /> : <NotificationsTab q={notes} />}
    </Page>
  )
}

function MessagesTab({ q }: { q: ReturnType<typeof useQuery<Thread[]>> }) {
  const threads = q.data ?? []
  if (q.loading) return <RideCardSkeleton />
  if (threads.length === 0)
    return <StateView icon={<MessageCircle />} title="No messages yet" body="When a driver accepts your request — or you accept a rider — you can chat about the pickup here." />
  const active = threads.filter((t) => !ENDED.includes(t.status))
  const past = threads.filter((t) => ENDED.includes(t.status))
  return (
    <div className="stack">
      {[
        { label: 'Upcoming rides', items: active },
        { label: 'Past rides', items: past },
      ]
        .filter((g) => g.items.length)
        .map((g) => (
          <section key={g.label}>
            <h2 className="timeline__group">{g.label}</h2>
            <div className="stack gap-2">
              {g.items.map((t) => (
                <ThreadRow key={t.bookingId} t={t} />
              ))}
            </div>
          </section>
        ))}
    </div>
  )
}

function ThreadRow({ t }: { t: Thread }) {
  const { user } = useMe()
  const nav = useNavigate()
  const unread = t.unread ?? 0
  const mine = t.last?.senderId === user?.id
  const s = BOOKING_STATUS[t.status]
  const preview = t.last ? (t.last.system ? t.last.text : mine ? `You: ${t.last.text}` : t.last.text) : `Say hi to ${firstName(t.other.name)} about the pickup`
  return (
    <button type="button" className={cx('thread', unread > 0 && 'is-unread')} onClick={() => nav(`/chat/${t.bookingId}`)}>
      <Avatar name={t.other.name} src={t.other.photo} verified={t.other.verified} />
      <span className="thread__body">
        <span className="row row--between gap-2">
          <span className="thread__name truncate">{t.other.name}</span>
          <span className="thread__time">{t.last ? relative(t.last.createdAt) : ''}</span>
        </span>
        <span className="thread__trip truncate">
          {t.role === 'driver' ? 'Your rider' : 'Your driver'} · {t.ride.origin.name} → {t.ride.destination.name} · {dayTime(t.ride.departAt)}
        </span>
        <span className="row row--between gap-2">
          <span className={cx('thread__preview truncate', !t.last && 't-muted')}>{preview}</span>
          {unread > 0 ? <span className="count-badge">{unread > 9 ? '9+' : unread}</span> : !ENDED.includes(t.status) && <Badge tone={s.tone}>{s.short}</Badge>}
        </span>
      </span>
    </button>
  )
}

function NotificationsTab({ q }: { q: ReturnType<typeof useQuery<AppNotification[]>> }) {
  const nav = useNavigate()
  const [filter, setFilter] = useState('all')
  const all = (q.data ?? []).filter((n) => n.kind !== 'chat')
  const kinds = FILTERS.find((f) => f.key === filter)!.kinds
  const list = all.filter((n) => kinds.includes(n.kind))
  const unread = all.filter((n) => !n.read).length
  const [perm, setPerm] = useState(notificationPermission())
  // Opening the tab counts as reading it (like Uber / Instagram), so the badge clears.
  const seen = useRef(false)
  useEffect(() => {
    if (seen.current || unread === 0) return
    seen.current = true
    const t = setTimeout(() => void notifications.readAll(), 1500)
    return () => clearTimeout(t)
  }, [unread])

  const groups = new Map<string, AppNotification[]>()
  for (const n of list) {
    const label = ['Today', 'Yesterday'].includes(dayLabel(n.createdAt)) ? dayLabel(n.createdAt) : 'Earlier'
    groups.set(label, [...(groups.get(label) ?? []), n])
  }

  return (
    <>
      {perm === 'unknown' && (
        <div style={{ marginBottom: 12 }}>
          <Notice
            tone="ai"
            icon={<Bell />}
            title="Get notified instantly"
            action={
              <Button size="sm" variant="tonal" onClick={async () => setPerm(await requestNotificationPermission())}>
                Turn on
              </Button>
            }
          >
            Know the moment a driver accepts or arrives.
          </Notice>
        </div>
      )}
      {perm === 'denied' && (
        <p className="inbox-hint">
          <BellOff size={14} /> Alerts are off for this browser — you’ll still see everything here.
        </p>
      )}
      <div className="chip-row" style={{ margin: '0 0 4px' }} role="radiogroup" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" role="radio" aria-checked={filter === f.key} className="chip chip--sm" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      {q.loading ? (
        <RideCardSkeleton />
      ) : list.length === 0 ? (
        <StateView icon={<Bell />} title="You’re all caught up" body={filter === 'all' ? 'Ride requests, confirmations and payments will show up here.' : 'Nothing here yet.'} />
      ) : (
        <div className="stack">
          {[...groups].map(([label, items]) => (
            <section key={label}>
              <h2 className="timeline__group">{label}</h2>
              <div className="notif-list">
                {items.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className={cx('notif', !n.read && 'is-unread')}
                    onClick={() => {
                      if (!n.read) void notifications.read(n.id)
                      if (n.link) nav(n.link)
                    }}
                  >
                    <span className={cx('notif__icon', `notif__icon--${n.kind}`)}>{KIND_ICON[n.kind]}</span>
                    <span className="stack grow" style={{ minWidth: 0, gap: 2 }}>
                      <span className="row row--between gap-2">
                        <span className="t-body t-strong">{n.title}</span>
                        <span className="notif__time">{relative(n.createdAt)}</span>
                      </span>
                      <span className="notif__body">{n.body}</span>
                    </span>
                    {n.link ? <ChevronRight size={18} className="notif__chev" /> : !n.read && <span className="notif__dot" aria-label="Unread" />}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  )
}

/* ==========================================================================
   Chat
   ========================================================================== */

const QUICK = {
  rider: ['I’m at the pickup point', 'Running 2 min late', 'Where are you?', 'I have a bag', 'Thank you!'],
  driver: ['I’ve arrived', 'Leaving now', 'Stuck in traffic, 5 min', 'Which exit are you at?', 'Thank you!'],
}

export function ChatThread() {
  const { bookingId } = useParams()
  const { user } = useMe()
  const u = user!
  const nav = useNavigate()
  const toast = useToast()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [optimistic, setOptimistic] = useState<Message[]>([])
  const end = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const detail = useQuery<BookingDetail>(bookingId ? Q.booking(bookingId) : null)
  const mq = useQuery<Message[]>(bookingId ? Q.messages(bookingId) : null)
  const notes = useQuery<AppNotification[]>(Q.notifications)
  const msgs = [...(mq.data ?? []), ...optimistic.filter((o) => !(mq.data ?? []).some((m) => m.senderId === o.senderId && m.text === o.text && Math.abs(+new Date(m.createdAt) - +new Date(o.createdAt)) < 60_000))]

  useLayoutEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [msgs.length])

  useEffect(() => {
    // Mark chat notifications for this thread as read.
    notes.data?.filter((n) => n.kind === 'chat' && n.link === `/chat/${bookingId}` && !n.read).forEach((n) => void notifications.read(n.id))
  }, [notes.data, bookingId])

  // Grow the message box with its text, up to five lines.
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [text])

  if (detail.loading) return <div className="page"><div className="page__content" style={{ paddingTop: 40 }}><RideCardSkeleton /></div></div>
  if (!detail.data) return <Navigate to="/chat" replace />
  const { booking, ride, vehicle, role } = detail.data
  const other = role === 'rider' ? detail.data.driver : detail.data.rider
  const otherPhone = role === 'rider' ? detail.data.driverPhone : detail.data.riderPhone
  const closed = ['cancelled', 'rejected', 'pending'].includes(booking.status) || (booking.status === 'completed' && Date.now() - +new Date(booking.updatedAt) > 86_400_000)
  const s = BOOKING_STATUS[booking.status]
  const tripLink = role === 'rider' ? `/trip/${booking.id}` : `/drive/${ride.id}`

  async function send(t: string) {
    const v = t.trim()
    if (!v) return
    setSending(true)
    try {
      setText('')
      setOptimistic((o) => [...o, { id: `tmp-${Date.now()}`, threadId: booking.id, senderId: u.id, text: v, createdAt: new Date().toISOString() }])
      await bookings.send(booking.id, v)
    } catch (e) {
      toast({ tone: 'error', message: e instanceof ApiError ? e.message : 'Message not sent' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="page page--canvas chat-page">
      <header className="chat-head">
        <BackButton to="/chat" />
        <Avatar name={other.name} src={other.photo} size="sm" verified={other.verified} />
        <span className="stack grow" style={{ minWidth: 0 }}>
          <span className="t-body t-strong truncate">{other.name}</span>
          <span className="t-caption t-muted truncate" style={{ fontWeight: 400 }}>
            {role === 'rider' ? `Your driver · ${vehicle.color} ${vehicle.make} ${vehicle.model} · ${vehicle.plate}` : `Your rider · pickup at ${booking.pickup.name}`}
          </span>
        </span>
        {otherPhone && (
          <a className="chat-head__call" href={`tel:+91${otherPhone}`} aria-label={`Call ${firstName(other.name)}`}>
            <Phone />
          </a>
        )}
      </header>
      <Link to={tripLink} className="chat-trip">
        <span className="chat-trip__icon">
          <CarFront size={18} />
        </span>
        <span className="stack grow" style={{ minWidth: 0 }}>
          <span className="t-sm t-strong truncate">
            {booking.pickup.name} → {booking.drop.name}
          </span>
          <span className="t-caption t-muted" style={{ fontWeight: 400 }}>
            {dayTime(ride.departAt)}
          </span>
        </span>
        <Badge tone={s.tone}>{s.short}</Badge>
        <ChevronRight size={18} className="t-muted" />
      </Link>
      <div className="chat-scroll">
        <div className="chat">
          <div className="chat-privacy">
            <Lock size={12} /> Only you and {firstName(other.name)} can see these messages. Your number stays private unless you call.
          </div>
          {msgs.length === 0 && !closed && (
            <div className="chat-empty">
              <Avatar name={other.name} src={other.photo} size="lg" verified={other.verified} />
              <span className="t-body t-strong">Say hi to {firstName(other.name)}</span>
              <span className="t-sm t-muted">Sort out the pickup spot or tell them you’re running late.</span>
            </div>
          )}
          {msgs.map((m, i) => {
            const prev = msgs[i - 1]
            const next = msgs[i + 1]
            const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt)
            const day = newDay && <div className="chat-day">{dayLabel(m.createdAt)}</div>
            if (m.system)
              return (
                <div key={m.id} className="stack">
                  {day}
                  <div className="chat-system">{m.text}</div>
                </div>
              )
            const mine = m.senderId === u.id
            const groupEnd = !next || next.system || next.senderId !== m.senderId || +new Date(next.createdAt) - +new Date(m.createdAt) > 5 * 60_000
            const groupStart = !prev || prev.system || prev.senderId !== m.senderId || newDay || +new Date(m.createdAt) - +new Date(prev.createdAt) > 5 * 60_000
            return (
              <div key={m.id} className={cx('stack', groupStart && 'bubble-group-start')}>
                {day}
                <div className={cx('bubble', mine ? 'bubble--me' : 'bubble--them', !groupEnd && 'bubble--mid')}>{m.text}</div>
                {groupEnd && <span className={cx('bubble__time', mine && 'bubble__time--me')}>{m.id.startsWith('tmp-') ? 'Sending…' : time(m.createdAt)}</span>}
              </div>
            )
          })}
          <div ref={end} />
        </div>
      </div>
      {closed ? (
        <div className="composer" style={{ justifyContent: 'center' }}>
          <span className="t-sm t-muted" style={{ padding: 10 }}>
            {booking.status === 'pending' ? 'Chat opens once the driver accepts.' : 'This ride has ended. Chat is closed.'}{' '}
            <button className="t-strong t-primary" onClick={() => nav('/rides')}>
              My Rides
            </button>
          </span>
        </div>
      ) : (
        <div className="composer-wrap">
          <div className="chip-row" style={{ margin: 0, padding: '10px 16px 0' }}>
            {QUICK[role === 'driver' ? 'driver' : 'rider'].map((q) => (
              <button key={q} type="button" className="chip chip--sm" onClick={() => send(q)} disabled={sending}>
                {q}
              </button>
            ))}
          </div>
          <form
            className="composer"
            style={{ borderTop: 0 }}
            onSubmit={(e) => {
              e.preventDefault()
              void send(text)
            }}
          >
            <textarea
              ref={input}
              className="composer__input"
              rows={1}
              placeholder={`Message ${firstName(other.name)}…`}
              aria-label="Message"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send(text)
                }
              }}
            />
            <IconButton label="Send" className="composer__send" type="submit" disabled={!text.trim() || sending}>
              <Send />
            </IconButton>
          </form>
        </div>
      )}
    </div>
  )
}
