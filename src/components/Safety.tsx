import { motion } from 'framer-motion'
import { BadgeCheck, Copy, Hourglass, IdCard, KeyRound, Share2, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { User } from '@/lib/types'
import { ApiError, bookings, uploadIdCard } from '@/services/api'
import { useCelebrate } from './Celebrate'
import { ModalSheet } from './Sheet'
import { useToast } from './Toast'
import { Button, Notice } from './ui'

const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback)

/* ---- Ride start PIN ------------------------------------------------------ */

/** Rider: the 4-digit code to tell the driver at pickup. */
export function RidePinCard({ pin, plate }: { pin: string; plate?: string }) {
  return (
    <div className="pin-card" role="group" aria-label={`Your ride PIN is ${pin.split('').join(' ')}`}>
      <div className="row gap-2">
        <span className="pin-card__icon">
          <KeyRound />
        </span>
        <span className="stack" style={{ minWidth: 0 }}>
          <span className="t-body t-strong">Your ride PIN</span>
          <span className="t-sm t-muted">Tell your driver when you get in</span>
        </span>
      </div>
      <div className="pin-card__digits" aria-hidden>
        {pin.split('').map((d, i) => (
          <motion.span key={i} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.05 * i, type: 'spring', stiffness: 400, damping: 24 }}>
            {d}
          </motion.span>
        ))}
      </div>
      <span className="t-caption t-muted" style={{ fontWeight: 400 }}>
        <ShieldCheck style={{ width: 14, height: 14, verticalAlign: '-2px', marginRight: 4 }} />
        Only get in if the car{plate ? ` (${plate})` : ''} matches. Never share this PIN in chat.
      </span>
    </div>
  )
}

/** Driver: type the rider's PIN to start their trip. */
export function PinEntrySheet({ open, name, onClose, onVerify }: { open: boolean; name: string; onClose: () => void; onVerify: (pin: string) => Promise<unknown> }) {
  // One real input with the 4 boxes drawn over it: iPhone Safari won't move focus between separate boxes,
  // so typing into four inputs stopped after 2 digits there.
  const [pin, setPin] = useState('')
  const [focused, setFocused] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setPin('')
    setError(null)
    const t = setTimeout(() => input.current?.focus(), 120)
    return () => clearTimeout(t)
  }, [open])

  async function verify(code = pin) {
    if (code.length !== 4 || busy) return
    setBusy(true)
    setError(null)
    try {
      await onVerify(code)
    } catch (e) {
      setError(errText(e, 'Couldn’t check the PIN.'))
      setPin('')
      input.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  function type(raw: string) {
    const v = raw.replace(/\D/g, '').slice(0, 4)
    setPin(v)
    setError(null)
    if (v.length === 4) void verify(v)
  }

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title={`Enter ${name}’s ride PIN`}
      footer={
        <Button size="lg" block loading={busy} disabled={pin.length !== 4} onClick={() => verify()}>
          Verify & start trip
        </Button>
      }
    >
      <div className="stack gap-4">
        <p className="t-body t-secondary">Ask {name} for the 4-digit PIN on their screen. It confirms they’re getting into the right car.</p>
        <div className={`pin-input${error ? ' is-error' : ''}`} onClick={() => input.current?.focus()}>
          <input
            ref={input}
            className="pin-input__field"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            maxLength={4}
            value={pin}
            aria-label={`${name}’s 4-digit ride PIN`}
            disabled={busy}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => type(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void verify()}
          />
          {[0, 1, 2, 3].map((i) => (
            <span key={i} aria-hidden className={`pin-input__cell${focused && i === Math.min(pin.length, 3) ? ' is-active' : ''}`}>
              {pin[i] ?? ''}
            </span>
          ))}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </ModalSheet>
  )
}

/* ---- Share live trip ---------------------------------------------------- */

/** Live tracking link for family or friends: `start()` creates it and opens the WhatsApp / copy sheet. */
export function useShareTrip(bookingId: string) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<{ url: string; text: string; local: boolean } | null>(null)

  async function start() {
    setBusy(true)
    try {
      setLink(await bookings.share(bookingId))
      setOpen(true)
    } catch (e) {
      toast({ tone: 'error', message: errText(e, 'Couldn’t create the link.') })
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      toast({ tone: 'success', message: 'Link copied' })
    } catch {
      toast({ tone: 'error', message: link.url })
    }
  }

  const sheet = (
    <ModalSheet open={open} onClose={() => setOpen(false)} title="Share your trip live">
      <div className="stack gap-4">
        <p className="t-body t-secondary">Family and friends can watch the car on a map until you’re dropped off — no app or sign-in needed.</p>
        {link?.local && <Notice tone="warning">This link only works on this computer. Run share.bat on the laptop so others can open it.</Notice>}
        <a className="btn btn--lg btn--block share-wa" href={`https://wa.me/?text=${encodeURIComponent(link?.text ?? '')}`} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
          <span className="btn__label">
            <WhatsAppIcon />
            Send on WhatsApp
          </span>
        </a>
        {typeof navigator.share === 'function' && (
          <Button variant="secondary" block icon={<Share2 />} onClick={() => link && navigator.share({ title: 'My RideSync trip', text: link.text }).catch(() => {})}>
            More apps
          </Button>
        )}
        <Button variant="ghost" block icon={<Copy />} onClick={copy}>
          Copy link
        </Button>
      </div>
    </ModalSheet>
  )
  return { start, busy, sheet }
}

export function ShareTripButton({ bookingId, block }: { bookingId: string; block?: boolean }) {
  const { start, busy, sheet } = useShareTrip(bookingId)
  return (
    <>
      <Button variant="secondary" block={block} icon={<Share2 />} loading={busy} onClick={start}>
        Share trip live
      </Button>
      {sheet}
    </>
  )
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="currentColor">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.5-.3Z" />
    </svg>
  )
}

/* ---- Verified student ID ------------------------------------------------ */

/** Downscale an ID card photo to a readable JPEG under the upload limit. */
export function toIdJpeg(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(img.src)
      for (const [max, q] of [
        [1400, 0.8],
        [1100, 0.7],
        [900, 0.6],
        [700, 0.55],
      ] as const) {
        const k = Math.min(1, max / Math.max(img.width, img.height))
        const c = document.createElement('canvas')
        c.width = Math.round(img.width * k)
        c.height = Math.round(img.height * k)
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
        const out = c.toDataURL('image/jpeg', q)
        if (out.length < 370_000) return resolve(out)
      }
      reject(new Error('That photo is too large. Try a closer, simpler photo of the card.'))
    }
    img.onerror = () => reject(new Error('That file isn’t an image we can read.'))
    img.src = URL.createObjectURL(file)
  })
}

/** Profile card: upload your VIT ID card to get the Verified badge. */
export function IdVerifyCard({ user }: { user: User }) {
  const input = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const celebrate = useCelebrate()
  const [busy, setBusy] = useState(false)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      await uploadIdCard(await toIdJpeg(file))
      celebrate({ kind: 'sent', title: 'ID card sent', body: 'A RideSync admin will check it soon. You’ll get a notification.' })
    } catch (err) {
      toast({ tone: 'error', message: errText(err, 'Couldn’t upload the photo.') })
    } finally {
      setBusy(false)
    }
  }

  const s = user.idStatus ?? 'none'
  return (
    <div className={`id-card id-card--${s}`}>
      <span className="id-card__icon">{s === 'verified' ? <BadgeCheck /> : s === 'pending' ? <Hourglass /> : <IdCard />}</span>
      <span className="stack grow gap-1" style={{ minWidth: 0 }}>
        <span className="t-body t-strong">{s === 'verified' ? 'Verified VIT student' : s === 'pending' ? 'ID card under review' : s === 'rejected' ? 'ID card not verified' : 'Get the Verified badge'}</span>
        <span className="t-sm t-muted">
          {s === 'verified'
            ? 'Others see the blue tick on your profile and rides.'
            : s === 'pending'
              ? 'We’ll notify you once a RideSync admin has checked it.'
              : s === 'rejected'
                ? `${user.idNote ?? 'The photo wasn’t clear.'} Upload a clearer photo.`
                : 'Upload a photo of your VIT ID card. Verified students get more bookings.'}
        </span>
      </span>
      {(s === 'none' || s === 'rejected') && (
        <Button size="sm" loading={busy} onClick={() => input.current?.click()}>
          {s === 'rejected' ? 'Upload again' : 'Upload ID'}
        </Button>
      )}
      <input ref={input} type="file" accept="image/*" hidden onChange={onFile} />
    </div>
  )
}

/** Small pink tag for women-only rides. */
export function WomenOnlyTag() {
  return <span className="badge badge--women">Women only</span>
}
