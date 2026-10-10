import type { Place } from '../src/lib/types'
import { all, db, one, run } from './db'
import { searchPlaces } from './maps'
import { CAMPUS, classify, crossValidate, entities, model, type Intent, type KnownPlace } from './ml/nlp'

/** RideSync Assistant: understands a message (intent + entities) and answers with actions. */

db.exec(`CREATE TABLE IF NOT EXISTS assistant_log (id INTEGER PRIMARY KEY AUTOINCREMENT, intent TEXT NOT NULL, confidence REAL NOT NULL, at TEXT NOT NULL)`)

export type AssistantAction =
  | { type: 'search'; label: string; query: { pickup: Place; drop: Place; date?: string; time?: string; seats?: number } }
  | { type: 'link'; label: string; to: string }
  | { type: 'call'; label: string; tel: string }
export type AssistantReply = { intent: Intent | 'unknown'; confidence: number; reply: string; actions: AssistantAction[]; suggestions: string[] }

const toPlace = (p: KnownPlace): Place => ({ id: p.id, name: p.name, area: p.area, lat: p.lat, lng: p.lng, kind: p.kind as Place['kind'] })
const SUGGEST = ['Find a ride to Andheri tomorrow 8 am', 'When is my next ride?', 'How are prices calculated?', 'I feel unsafe']
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
const timeLabel = (date?: string, time?: string) => {
  if (!date && !time) return 'soon'
  const parts = []
  if (date) parts.push(new Date(`${date}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }))
  if (time) parts.push(new Date(`2000-01-01T${time}:00`).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }))
  return parts.join(', ')
}

export async function answer(userId: string, firstName: string, text: string): Promise<AssistantReply> {
  const c = classify(model, text)
  const e = entities(text)
  const intent: Intent | 'unknown' = c.confidence >= 0.45 ? c.intent : 'unknown'
  run(`INSERT INTO assistant_log (intent, confidence, at) VALUES (?, ?, ?)`, intent, Math.round(c.confidence * 100) / 100, new Date().toISOString())
  const r = (reply: string, actions: AssistantAction[] = [], suggestions: string[] = []): AssistantReply => ({ intent, confidence: Math.round(c.confidence * 100) / 100, reply, actions, suggestions })

  switch (intent) {
    case 'find_ride': {
      let to: Place | undefined = e.to ? toPlace(e.to) : undefined
      let from: Place | undefined = e.from ? toPlace(e.from) : undefined
      if (!to && e.unknownPlace) {
        const hit = (await searchPlaces(e.unknownPlace).catch(() => []))[0]
        if (hit) to = hit
      }
      if (!to && !from) return r('Sure — where do you want to go? For example: “ride to Dadar tomorrow at 8 am”.', [], ['Ride to college tomorrow 9 am', 'Ride to Andheri today 6 pm'])
      // One place given: the other end is campus (most RideSync trips are to/from VIT).
      if (!from) from = to?.id === CAMPUS.id ? undefined : toPlace(CAMPUS)
      if (!to) to = toPlace(CAMPUS)
      if (!from) return r(`Got it, to ${to.name}. Where should you be picked up? e.g. “from Andheri to college tomorrow 8 am”.`)
      return r(`Searching rides from ${from.name} to ${to.name}, ${timeLabel(e.date, e.time)}${e.seats ? ` for ${e.seats} seats` : ''}…`, [
        { type: 'search', label: 'Show matching rides', query: { pickup: from, drop: to, date: e.date, time: e.time, seats: e.seats } },
      ])
    }
    case 'offer_ride':
      return r(
        `Great, ${firstName}! Open “Offer a ride”${e.to ? `, set the destination to ${e.to.name}` : ''}${e.time ? ` and the time to ${timeLabel(undefined, e.time)}` : ''}${e.seats ? ` with ${e.seats} seats` : ''}. RideSync suggests a fair price and students going your way can book.`,
        [{ type: 'link', label: 'Offer a ride', to: '/offer' }],
      )
    case 'next_trip': {
      const b = one(
        `SELECT b.id, b.status, r.depart_at, r.destination, u.name FROM bookings b JOIN rides r ON r.id = b.ride_id JOIN users u ON u.id = r.driver_id WHERE b.rider_id = ? AND b.status IN ('pending','accepted','confirmed','driver_arriving','driver_arrived','in_progress') ORDER BY r.depart_at LIMIT 1`,
        userId,
      )
      const o = one(`SELECT id, depart_at, destination FROM rides WHERE driver_id = ? AND status IN ('scheduled','in_progress') ORDER BY depart_at LIMIT 1`, userId)
      if (!b && !o) return r('You have no upcoming rides. Want me to find one?', [{ type: 'link', label: 'Find a ride', to: '/find' }], ['Find a ride to college tomorrow 9 am'])
      const lines: string[] = []
      const actions: AssistantAction[] = []
      if (b) {
        lines.push(`Your next ride: with ${String(b.name).split(' ')[0]} to ${JSON.parse(String(b.destination)).name}, ${when(String(b.depart_at))} (${String(b.status).replace('_', ' ')}).`)
        actions.push({ type: 'link', label: 'Open trip', to: `/trip/${b.id}` })
      }
      if (o) {
        lines.push(`You’re driving to ${JSON.parse(String(o.destination)).name}, ${when(String(o.depart_at))}.`)
        actions.push({ type: 'link', label: 'Open your ride', to: `/drive/${o.id}` })
      }
      return r(lines.join(' '), actions)
    }
    case 'driver_status': {
      const b = one(`SELECT b.id, b.status, u.name FROM bookings b JOIN rides r ON r.id = b.ride_id JOIN users u ON u.id = r.driver_id WHERE b.rider_id = ? AND b.status IN ('confirmed','driver_arriving','driver_arrived','in_progress') ORDER BY r.depart_at LIMIT 1`, userId)
      if (!b) return r('You don’t have a ride in progress right now.', [{ type: 'link', label: 'My rides', to: '/rides' }])
      const name = String(b.name).split(' ')[0]
      const msg = { confirmed: `${name} hasn’t started yet — you’ll be notified when they do, and again when they’re 2 minutes away.`, driver_arriving: `${name} is on the way to your pickup. Watch the car live on the map.`, driver_arrived: `${name} has arrived at your pickup! Tell them your 4-digit ride PIN.`, in_progress: 'You’re in the car — enjoy the ride. You can share your trip live with family.' }[String(b.status)]
      return r(msg ?? 'Open your trip to see the latest.', [{ type: 'link', label: 'Track live', to: `/live/${b.id}` }])
    }
    case 'cancel':
      return r('Open the trip and tap “Cancel seat” (or “Cancel ride” if you’re driving). Online and wallet payments are refunded automatically. Frequent cancellations lower your reliability.', [{ type: 'link', label: 'My rides', to: '/rides' }])
    case 'verify':
      return r('Go to Profile → “Get the Verified badge” and upload a clear photo of your VIT ID card. Our AI reads the card (OCR) and an admin confirms — then you get the blue tick on your profile and rides.', [{ type: 'link', label: 'Upload ID card', to: '/profile' }])
    case 'pin':
      return r('Your 4-digit ride PIN is shown on your trip screen once the driver accepts. Tell it to the driver when you get in — it proves you’re in the right car. Never share it in chat.', [{ type: 'link', label: 'My rides', to: '/rides' }])
    case 'pricing':
      return r('RideSync is cost-sharing: price per seat = trip distance × fuel cost per km (petrol ₹11, diesel ₹10, CNG ₹7, EV ₹5) ÷ (seats + driver), rounded to ₹10, minimum ₹40. Drivers can’t charge more than 1.5× that.')
    case 'refund':
      return r('If a ride is cancelled, wallet payments return to your wallet instantly and online payments go back to your bank in 5–7 working days. UPI/cash paid to the driver is refunded by the driver directly.', [{ type: 'link', label: 'Wallet', to: '/wallet' }])
    case 'wallet':
      return r('Add money in Wallet (₹10–₹5,000 at a time, up to ₹10,000), then pay any ride in one tap. You can also pay online, by UPI to the driver, or in cash.', [{ type: 'link', label: 'Open wallet', to: '/wallet' }])
    case 'women_only':
      return r('Yes! Female drivers can mark a ride “Women only” when offering it — only female students can see and book those rides. Set your gender in Profile to see them.', [{ type: 'link', label: 'Find a ride', to: '/find' }])
    case 'safety': {
      const b = one(`SELECT b.id FROM bookings b WHERE b.rider_id = ? AND b.status IN ('driver_arriving','driver_arrived','in_progress') LIMIT 1`, userId)
      return r('I’m here to help. If you’re in danger call 112 now. In your trip you can also tap SOS to alert your emergency contacts with your location.', [
        { type: 'call', label: 'Call 112', tel: '112' },
        ...(b ? [{ type: 'link' as const, label: 'Open trip & SOS', to: `/live/${b.id}` }] : []),
      ])
    }
    case 'share_trip':
      return r('During a ride, tap “Share trip” → “Send on WhatsApp”. Your family gets a live link to watch the car on a map until you’re dropped — no app needed.', [{ type: 'link', label: 'My rides', to: '/rides' }])
    case 'greeting':
      return r(`Hi ${firstName}! I’m the RideSync Assistant. I can find rides, check your trips and answer questions.`, [], SUGGEST)
    case 'thanks':
      return r('Happy to help! Have a safe ride 🚗', [], SUGGEST.slice(0, 2))
    case 'help':
      return r('Try things like: “ride to Dadar tomorrow 8 am”, “I’m driving to Thane at 6 pm”, “when is my next ride?”, “where is my driver?”, “how do refunds work?”. I understand Hinglish too — “kal subah Andheri jaana hai”.', [], SUGGEST)
    default:
      return r('Sorry, I didn’t get that. Here are some things I can help with:', [], SUGGEST)
  }
}

/** For Admin → AI. */
export function assistantStats() {
  const cv = crossValidate()
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const top = all<{ intent: string; n: number }>(`SELECT intent, COUNT(*) n FROM assistant_log WHERE at >= ? GROUP BY intent ORDER BY n DESC LIMIT 6`, since)
  const total = Number(one<{ n: number }>(`SELECT COUNT(*) n FROM assistant_log WHERE at >= ?`, since)?.n ?? 0)
  const unknown = top.find((t) => t.intent === 'unknown')?.n ?? 0
  return { ...cv, messages30d: total, understoodRate: total ? Math.round(((total - unknown) / total) * 100) / 100 : null, topIntents: top }
}
