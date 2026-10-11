import { isShareBooking, payNowAmount } from '@/lib/fare'
import { AnimatePresence, motion } from 'framer-motion'
import { Banknote, CreditCard, Copy, FlaskConical, Lock, Smartphone, Wallet as WalletIcon } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { StateView } from '@/components/States'
import { TopBar } from '@/components/TopBar'
import { useToast } from '@/components/Toast'
import { Button, Field, Notice, RideCardSkeleton, cx } from '@/components/ui'
import { useIsDesktop } from '@/hooks'
import { firstName, money } from '@/lib/format'
import { openCheckout } from '@/lib/razorpay'
import { ApiError, Q, bookings, payOnline, useConfig, useQuery, wallet, type BookingDetail, type WalletInfo } from '@/services/api'
import { SuccessMark } from './trip'

/**
 * Ways to pay the cost-share:
 *   wallet — RideSync Wallet balance (topped up through Razorpay); refunded to the wallet on cancellation
 *   online — Razorpay Checkout (UPI, cards, netbanking); verified on the server, auto-refunded on cancellation
 *   upi    — straight to the driver's UPI ID (deep link on phones, QR on desktop)
 *   cash   — at pickup
 */

export function upiLink(pa: string, pn: string, amount: number, note: string) {
  const p = new URLSearchParams({ pa, pn, am: amount.toFixed(2), cu: 'INR', tn: note.slice(0, 60) })
  return `upi://pay?${p.toString().replace(/\+/g, '%20')}`
}

export function Payment() {
  const { bookingId } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const desktop = useIsDesktop()
  const q = useQuery<BookingDetail>(bookingId ? Q.booking(bookingId) : null)
  const config = useConfig()
  const rzpKey = config.data?.razorpayKeyId ?? null
  const w = useQuery<WalletInfo>(Q.wallet)
  const [method, setMethod] = useState<'wallet' | 'online' | 'upi' | 'cash' | null>(null)
  const [opened, setOpened] = useState(false)
  const [ref, setRef] = useState('')
  const [qr, setQr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<'wallet' | 'online' | 'upi' | 'cash' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const d = q.data
  const link = d?.driverUpiId ? upiLink(d.driverUpiId, d.driver.name, payNowAmount(d.booking, 'upi'), `RideSync ${d.booking.pickup.name} to ${d.booking.drop.name}`) : null

  useEffect(() => {
    // Wait for the server config so "Pay online" is the default when the gateway is set up.
    if (d && config.data && method === null) setMethod((w.data?.balance ?? 0) >= payNowAmount(d.booking, 'wallet') ? 'wallet' : rzpKey ? 'online' : d.driverUpiId ? 'upi' : 'cash')
  }, [d, method, rzpKey, config.data, w.data])
  useEffect(() => {
    if (link && desktop) QRCode.toDataURL(link, { margin: 1, width: 240, color: { dark: '#15182E', light: '#FFFFFF' } }).then(setQr).catch(() => setQr(null))
  }, [link, desktop])

  if (q.loading)
    return (
      <div className="page">
        <div className="page__content page__content--narrow" style={{ paddingTop: 40 }}>
          <RideCardSkeleton />
        </div>
      </div>
    )
  if (!d) return <Navigate to="/rides" replace />
  const { booking, driver } = d
  const name = firstName(driver.name)
  const canPay = booking.status === 'accepted' || (booking.paymentMethod === 'cash' && booking.paymentStatus === 'unpaid' && ['confirmed', 'driver_arriving', 'driver_arrived', 'in_progress', 'completed'].includes(booking.status))
  if (d.role !== 'rider' || (!canPay && !done)) return <Navigate to={`/trip/${booking.id}`} replace />

  async function confirm(m: 'upi' | 'cash') {
    setSaving(true)
    setError(null)
    try {
      await bookings.pay(booking.id, m, m === 'upi' ? ref.trim() || undefined : undefined)
      setDone(m)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t confirm. Try again.')
    } finally {
      setSaving(false)
    }
  }

  async function payWithGateway() {
    setSaving(true)
    setError(null)
    try {
      const r = await openCheckout(await payOnline.createOrder(booking.id))
      if (!r) return
      await payOnline.verify(booking.id, r)
      setDone('online')
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Couldn’t start the payment.')
    } finally {
      setSaving(false)
    }
  }

  const balance = w.data?.balance ?? 0
  const share = isShareBooking(booking) && !booking.fareFinal
  const amount = payNowAmount(booking, method)
  const shortfall = Math.max(0, payNowAmount(booking, 'wallet') - balance)

  /** Pays from the wallet; tops up just the missing amount through Razorpay first if needed. */
  async function payWithWallet() {
    setSaving(true)
    setError(null)
    try {
      if (shortfall > 0) {
        const r = await openCheckout(await wallet.topUpOrder(Math.max(10, Math.ceil(shortfall))))
        if (!r) return
        await wallet.verifyTopUp(r)
      }
      await wallet.payBooking(booking.id)
      setDone('wallet')
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Couldn’t pay from your wallet.')
      void w.reload()
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className="page" style={{ justifyContent: 'center' }}>
        <div className="page__content page__content--narrow" style={{ flex: 'none' }}>
          <div className="hero">
            <SuccessMark />
            <h1 className="t-h1">Seat confirmed</h1>
            <p className="t-body t-muted">
              {done === 'wallet' ? `${money(payNowAmount(booking, 'wallet'))} paid from your RideSync Wallet. ${name} has been notified.` : done === 'online' ? `${money(payNowAmount(booking, 'online'))} paid online. ${name} has been notified.` : done === 'upi' ? `${name} has been told you paid ${money(booking.fare)} by UPI.` : `Pay ${name} your final share in cash at pickup.`}
              {share && (done === 'wallet' || done === 'online') && ' If your price is lower when the trip starts, the difference comes back to you automatically.'}
            </p>
          </div>
          <div className="stack gap-2" style={{ marginTop: 16 }}>
            <Button size="lg" block onClick={() => nav(`/trip/${booking.id}`, { replace: true })}>
              View trip
            </Button>
            <Button size="lg" variant="ghost" block onClick={() => nav(`/chat/${booking.id}`)}>
              Message {name}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (booking.status === 'cancelled' || booking.status === 'rejected')
    return <StateView icon={<Banknote />} tone="neutral" title="This booking is no longer active" actions={<Button block onClick={() => nav('/rides')}>My Rides</Button>} />

  return (
    <div className="page">
      <TopBar title="Payment" backTo={`/trip/${booking.id}`} actions={<span className="topbar__spacer" />} />
      <div className="page__content page__content--narrow">
        <div className="stack gap-6">
          <div className="pay-summary">
            <span className="t-sm t-muted">
              Ride with {driver.name} · {booking.pickup.name} → {booking.drop.name}
            </span>
            <div className="bill" style={{ marginTop: 12 }}>
              <div className="bill__row">
                <span>{share ? 'Your booked price' : 'Cost share'}</span>
                <span>{money(share ? booking.fareMax! : booking.fare)}</span>
              </div>
              {share && booking.fare < booking.fareMax! && (
                <div className="bill__row t-success">
                  <span>Your price now (more riders joined)</span>
                  <span>{money(booking.fare)}</span>
                </div>
              )}
              <div className="bill__row">
                <span>Platform fee</span>
                <span className="t-success">Free</span>
              </div>
              <div className="bill__row bill__row--total">
                <span>{share ? 'Pay now' : 'Total'}</span>
                <span>{money(amount)}</span>
              </div>
              {share && (
                <p className="t-sm t-muted" style={{ marginTop: 6 }}>
                  {method === 'cash'
                    ? `Your price never goes up. Pay ${name} the final price in cash at pickup; it’s fixed when the trip starts and can only be lower.`
                    : `Your price never goes up. If it’s lower when ${name} starts the trip (more riders joined, or lighter traffic), the difference comes back to you ${method === 'upi' ? `from ${name}` : 'automatically'}.`}
                </p>
              )}
            </div>
          </div>

          <div className="stack gap-2" role="radiogroup" aria-label="Payment method">
            {(rzpKey || balance > 0) && (
              <MethodOption
                selected={method === 'wallet'}
                onSelect={() => setMethod('wallet')}
                logo={<WalletIcon />}
                title="RideSync Wallet"
                subtitle={shortfall > 0 ? `Balance ${money(balance)} · add ${money(shortfall)} to pay` : `Balance ${money(balance)} · instant · refunded to wallet if cancelled`}
              />
            )}
            {rzpKey && (
              <MethodOption
                selected={method === 'online'}
                onSelect={() => setMethod('online')}
                logo={<CreditCard />}
                title="Card, UPI or netbanking"
                subtitle="Secured by Razorpay · refunded automatically if cancelled"
              />
            )}
            {rzpKey?.startsWith('rzp_test_') && (method === 'online' || (method === 'wallet' && shortfall > 0)) && (
              <Notice tone="warning" icon={<FlaskConical />} title="Razorpay test mode">
                No real money moves. Use UPI ID <strong>success@razorpay</strong> or card <strong>4111 1111 1111 1111</strong> (any future expiry, any CVV).
              </Notice>
            )}
            <MethodOption
              selected={method === 'upi'}
              disabled={!d.driverUpiId}
              onSelect={() => setMethod('upi')}
              logo={<Smartphone />}
              title="UPI to driver"
              subtitle={d.driverUpiId ? `Google Pay · PhonePe · Paytm · any UPI app` : `${name} hasn’t added a UPI ID yet`}
            />
            <AnimatePresence initial={false}>
              {method === 'upi' && link && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                  <div className="stack gap-4" style={{ padding: '12px 2px 8px' }}>
                    {desktop ? (
                      <div className="upi-qr">
                        {qr ? <img src={qr} alt={`UPI QR code to pay ${money(amount)} to ${driver.name}`} width={200} height={200} /> : <div className="skel" style={{ width: 200, height: 200 }} />}
                        <span className="t-sm t-muted t-center">Scan with any UPI app on your phone</span>
                      </div>
                    ) : (
                      <div className="stack gap-2">
                        <span className="t-caption t-muted">Pay {money(amount)} with</span>
                        {/* Each app's own UPI link, with the amount and driver filled in. */}
                        <div className="upi-apps">
                          {[
                            { name: 'Google Pay', scheme: 'tez://upi/pay', color: '#1a73e8', initial: 'G' },
                            { name: 'PhonePe', scheme: 'phonepe://pay', color: '#5f259f', initial: 'P' },
                            { name: 'Paytm', scheme: 'paytmmp://pay', color: '#00baf2', initial: 'P' },
                            { name: 'Other UPI app', scheme: 'upi://pay', color: 'var(--ink-700)', initial: '…' },
                          ].map((a) => (
                            <a key={a.name} className="upi-app" href={`${a.scheme}?${link.split('?')[1]}`} onClick={() => setOpened(true)}>
                              <span className="upi-app__logo" style={{ background: a.color }}>{a.initial}</span>
                              {a.name}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="row gap-2 upi-id">
                      <span className="t-sm grow truncate">
                        UPI ID <strong>{d.driverUpiId}</strong>
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Copy />}
                        onClick={() => {
                          void navigator.clipboard?.writeText(d.driverUpiId!)
                          toast({ tone: 'success', message: 'UPI ID copied' })
                        }}
                      >
                        Copy
                      </Button>
                    </div>
                    <Field label="UPI reference / UTR (optional)" inputMode="numeric" placeholder="12-digit number from your UPI app" value={ref} onChange={(e) => setRef(e.target.value.replace(/[^0-9A-Za-z]/g, '').slice(0, 30))} hint="Helps the driver find your payment." />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <MethodOption selected={method === 'cash'} onSelect={() => setMethod('cash')} logo={<Banknote />} title="Cash at pickup" subtitle={`Pay ${name} when you get in`} />
          </div>

          {error && <Notice tone="error">{error}</Notice>}
          <p className="t-caption t-muted" style={{ fontWeight: 400 }}>
            Online payments are verified by RideSync and refunded automatically if the ride is cancelled. UPI and cash go straight to {name}, who refunds you directly if needed.
          </p>
        </div>
      </div>
      <div className="page__footer page__footer--narrow">
        {method === 'wallet' ? (
          <Button size="lg" block icon={<WalletIcon />} loading={saving} disabled={shortfall > 0 && !rzpKey} onClick={payWithWallet}>
            {shortfall > 0 ? `Add ${money(Math.max(10, Math.ceil(shortfall)))} & pay` : `Pay ${money(amount)} from wallet`}
          </Button>
        ) : method === 'online' ? (
          <Button size="lg" block icon={<Lock />} loading={saving} onClick={payWithGateway}>
            Pay {money(amount)}
          </Button>
        ) : method === 'upi' ? (
          <Button size="lg" block loading={saving} onClick={() => confirm('upi')}>
            {opened || desktop ? `I’ve paid ${money(amount)}` : `I’ve paid ${money(amount)} by UPI`}
          </Button>
        ) : (
          <Button size="lg" block loading={saving} onClick={() => confirm('cash')}>
            Confirm seat · pay cash
          </Button>
        )}
      </div>
    </div>
  )
}

function MethodOption({ selected, onSelect, logo, title, subtitle, disabled }: { selected: boolean; onSelect: () => void; logo: React.ReactNode; title: string; subtitle?: string; disabled?: boolean }) {
  return (
    <button type="button" role="radio" aria-checked={selected} disabled={disabled} className={cx('pay-option', selected && 'is-selected')} onClick={onSelect} style={disabled ? { opacity: 0.55 } : undefined}>
      <span className="pay-option__logo">{logo}</span>
      <span className="pay-option__body">
        <span className="pay-option__title" style={{ display: 'block' }}>
          {title}
        </span>
        {subtitle && <span className="pay-option__sub">{subtitle}</span>}
      </span>
      <span className={cx('radio', selected && 'is-checked')} aria-hidden />
    </button>
  )
}
