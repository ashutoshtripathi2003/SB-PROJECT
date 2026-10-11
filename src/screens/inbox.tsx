import { Bell, BellOff, CarFront, CircleCheck, CircleX, CreditCard, MessageCircle, Navigation, Phone, Send, Sparkle, UserPlus } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { StateView } from '@/components/States'
import { TopBar } from '@/components/TopBar'
import { Avatar, Button, IconButton, Notice, cx } from '@/components/ui'
import { firstName, relative, time } from '@/lib/format'
import type { AppNotification, Message, NotificationKind, Thread } from '@/lib/types'
import { Page } from '@/layouts/Page'
import { ApiError, Q, bookings, notificationPermission, notifications, requestNotificationPermission, useMe, useQuery, type BookingDetail } from '@/services/api'
import { useToast } from '@/components/Toast'
import { RideCardSkeleton } from '@/components/ui'

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

/* ==========================================================================
   Notifications
   ========================================================================== */

export function Notifications() {
  const nav = useNavigate()
  const q = useQuery<AppNotification[]>(Q.notifications)
  const list = q.data ?? []
  const unread = list.filter((n) => !n.read).length
  const [perm, setPerm] = useState(notificationPermission())
  // Opening this page counts as reading it (like Uber / Instagram), so the badge clears.
  const seen = useRef(false)
  useEffect(() => {
    if (seen.current || unread === 0) return
    seen.current = true
    void notifications.readAll()
  }, [unread])

  const today = list.filter((n) => Date.now() - +new Date(n.createdAt) < 86_400_000)
  const earlier = list.filter((n) => Date.now() - +new Date(n.createdAt) >= 86_400_000)

  return (
    <Page
      title="Notifications"
      actions={
        unread > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => notifications.readAll()} style={{ marginRight: 4 }}>
            Mark all read
          </Button>
        ) : (
          <span className="topbar__spacer" />
        )
      }
    >
      {perm === 'unknown' && (
        <div style={{ marginBottom: 16 }}>
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
            Know the moment a driver accepts or arrives, even when RideSync is in the background.
          </Notice>
        </div>
      )}
      {perm === 'denied' && (
        <div style={{ marginBottom: 16 }}>
          <Notice icon={<BellOff />} title="Notifications are blocked">
            You’ll still see updates here. To get alerts, allow notifications for this site in your browser settings.
          </Notice>
        </div>
      )}
      {q.loading ? (
        <RideCardSkeleton />
      ) : list.length === 0 ? (
        <StateView icon={<Bell />} title="You’re all caught up" body="Ride requests, confirmations and messages will show up here." />
      ) : (
        <div className="stack">
          {[
            { label: 'Today', items: today },
            { label: 'Earlier', items: earlier },
          ]
            .filter((g) => g.items.length)
            .map((g) => (
              <section key={g.label}>
                <h2 className="timeline__group">{g.label}</h2>
                {g.items.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className={cx('notif', !n.read && 'is-unread')}
                    onClick={() => {
                      if (!n.read) void notifications.read(n.id)
                      if (n.link) nav(n.link)
                    }}
                  >
                    <span className={cx('list-row__icon', `notif__icon--${n.kind}`)}>{KIND_ICON[n.kind]}</span>
                    <span className="stack grow" style={{ minWidth: 0, gap: 2 }}>
                      <span className="t-body t-strong">{n.title}</span>
                      <span className="t-sm t-secondary">{n.body}</span>
                      <span className="t-caption t-muted" style={{ fontWeight: 400 }}>
                        {relative(n.createdAt)}
                      </span>
                    </span>
                    {!n.read && <span className="notif__dot" aria-label="Unread" />}
                  </button>
                ))}
              </section>
            ))}
        </div>
      )}
    </Page>
  )
}

/* ==========================================================================
   Chat
   ========================================================================== */

export function ChatList() {
  const { user } = useMe()
  const u = user!
  const nav = useNavigate()
  const q = useQuery<Thread[]>(Q.threads)
  const threads = q.data ?? []
  return (
    <Page title="Messages">
      {q.loading ? (
        <RideCardSkeleton />
      ) : threads.length === 0 ? (
        <StateView icon={<MessageCircle />} title="No messages yet" body="Once a ride is confirmed you can message your driver or riders here." />
      ) : (
        <div className="list">
          {threads.map((t) => (
            <button key={t.bookingId} type="button" className="list-row" onClick={() => nav(`/chat/${t.bookingId}`)}>
              <Avatar name={t.other.name} src={t.other.photo} verified={t.other.verified} />
              <span className="list-row__body">
                <span className="row row--between gap-2">
                  <span className="list-row__title truncate">{t.other.name}</span>
                  {t.last && <span className="t-caption t-muted" style={{ fontWeight: 400, flex: 'none' }}>{relative(t.last.createdAt)}</span>}
                </span>
                <span className="list-row__sub truncate">{t.last ? (t.last.senderId === u.id ? `You: ${t.last.text}` : t.last.text) : `${t.ride.origin.name} → ${t.ride.destination.name}`}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Page>
  )
}

const QUICK = ['I’m at the pickup point', 'Running 2 min late', 'Where are you?', 'I have a bag']

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

  if (detail.loading) return <div className="page"><div className="page__content" style={{ paddingTop: 40 }}><RideCardSkeleton /></div></div>
  if (!detail.data) return <Navigate to="/chat" replace />
  const { booking, ride } = detail.data
  const other = detail.data.role === 'rider' ? detail.data.driver : detail.data.rider
  const otherPhone = detail.data.role === 'rider' ? detail.data.driverPhone : detail.data.riderPhone
  const closed = ['cancelled', 'rejected', 'pending'].includes(booking.status) || (booking.status === 'completed' && Date.now() - +new Date(booking.updatedAt) > 86_400_000)

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
      <TopBar
        title={
          <span className="row gap-3" style={{ justifyContent: 'center' }}>
            <Avatar name={other.name} src={other.photo} size="xs" />
            <span className="stack" style={{ alignItems: 'flex-start' }}>
              <span className="t-body t-strong">{other.name}</span>
              <span className="t-caption t-muted" style={{ fontWeight: 400 }}>
                {ride.origin.name} → {ride.destination.name} · {time(ride.departAt)}
              </span>
            </span>
          </span>
        }
        actions={
          otherPhone ? (
            <a className="icon-btn" href={`tel:+91${otherPhone}`} aria-label={`Call ${firstName(other.name)}`}>
              <Phone />
            </a>
          ) : (
            <span className="topbar__spacer" />
          )
        }
      />
      <div className="chat-scroll">
        <div className="chat">
          <div className="chat-system">
            <CarFront size={12} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />
            Messages are only between you and {firstName(other.name)} for this ride
          </div>
          {msgs.map((m, i) => {
            if (m.system) return <div key={m.id} className="chat-system">{m.text}</div>
            const mine = m.senderId === u.id
            const next = msgs[i + 1]
            const showTime = !next || next.senderId !== m.senderId || +new Date(next.createdAt) - +new Date(m.createdAt) > 5 * 60_000
            return (
              <div key={m.id} className="stack">
                <div className={cx('bubble', mine ? 'bubble--me' : 'bubble--them')}>{m.text}</div>
                {showTime && <span className={cx('bubble__time', mine && 'bubble__time--me')}>{time(m.createdAt)}</span>}
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
        <div style={{ background: 'var(--surface)' }}>
          <div className="chip-row" style={{ margin: 0, padding: '10px 16px 0' }}>
            {QUICK.map((q) => (
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
              className="composer__input"
              rows={1}
              placeholder={`Message ${firstName(other.name)}`}
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
