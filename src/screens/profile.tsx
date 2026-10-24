import {
  Bell,
  CarFront,
  ChevronRight,
  CircleQuestionMark,
  CreditCard,
  FileText,
  Leaf,
  LifeBuoy,
  LogOut,
  Mail,
  MessageCircle,
  Palette,
  Phone,
  Plus,
  Settings as SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
  Trash,
  UserRound,
  Layers,
  Music,
  Snowflake,
} from 'lucide-react'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { ConfirmDialog, ModalSheet } from '@/components/Sheet'
import { useToast } from '@/components/Toast'
import { VehicleForm } from '@/components/VehicleForm'
import { PhotoPicker } from '@/components/PhotoPicker'
import { Avatar, Button, Chip, Field, ListRow, Notice, Plate, Segmented, VerifiedBadge } from '@/components/ui'
import { PREFERENCE_LABEL } from '@/lib/matching'
import type { CommuteMode, Gender, RidePreference } from '@/lib/types'
import { validatePhone, validateStudentId } from '@/lib/validation'
import { Page } from '@/layouts/Page'
import { ApiError, auth, deleteAccount, notificationPermission, removeVehicle, requestNotificationPermission, saveVehicle, updateMe, useMe } from '@/services/api'
import { IdVerifyCard } from '@/components/Safety'
import { PREF_OPTIONS } from './find'

export function Profile() {
  const { user } = useMe()
  const u = user!
  const nav = useNavigate()
  const [signOut, setSignOut] = useState(false)

  return (
    <Page title="Profile" back={false} actions={<button className="icon-btn" aria-label="Settings" onClick={() => nav('/settings')} style={{ marginRight: 4 }}><SettingsIcon /></button>}>
      <div className="stack gap-6">
        <div className="profile-head">
          <button type="button" onClick={() => nav('/profile/personal')} aria-label="Edit profile photo" style={{ borderRadius: '50%' }}>
            <Avatar name={u.name} src={u.photo} size="xl" verified={u.verified} />
          </button>
          <div className="stack gap-1" style={{ alignItems: 'center' }}>
            <h1 className="t-h2">{u.name}</h1>
            <span className="t-sm t-muted">
              {u.studentId} · {u.email}
            </span>
          </div>
          {u.verified && <VerifiedBadge />}
        </div>

        <IdVerifyCard user={u} />

        <div className="card stats">
          <div className="stat">
            <span className="stat__value">{u.ridesTaken}</span>
            <span className="stat__label">Rides taken</span>
          </div>
          <div className="stat">
            <span className="stat__value">{u.ridesOffered}</span>
            <span className="stat__label">Rides offered</span>
          </div>
          <div className="stat">
            <span className="stat__value">{u.rating ? `★ ${u.rating.toFixed(1)}` : 'New'}</span>
            <span className="stat__label">Rating</span>
          </div>
          <div className="stat">
            <span className="stat__value">{Math.round(u.co2SavedKg)} kg</span>
            <span className="stat__label">CO₂ saved</span>
          </div>
        </div>

        {u.co2SavedKg > 0 && (
          <Notice tone="success" icon={<Leaf />}>
            Sharing rides has saved about {Math.round(u.co2SavedKg)} kg of CO₂ — what {Math.max(1, Math.round(u.co2SavedKg / 21))} {Math.max(1, Math.round(u.co2SavedKg / 21)) === 1 ? 'tree absorbs' : 'trees absorb'} in a year.
          </Notice>
        )}

        <div className="list">
          {u.isAdmin && <ListRow icon={<ShieldCheck />} title="Admin dashboard" subtitle="Rides, bookings, cancellations, students and ID checks" onClick={() => nav('/admin')} />}
          <ListRow icon={<UserRound />} title="Personal Information" subtitle={`${u.email}`} onClick={() => nav('/profile/personal')} />
          <ListRow icon={<CarFront />} title="Vehicle Information" subtitle={u.vehicle ? `${u.vehicle.make} ${u.vehicle.model} · ${u.vehicle.plate}` : 'Add a car to offer rides'} onClick={() => nav('/profile/vehicle')} />
          <ListRow icon={<SlidersHorizontal />} title="Preferences" subtitle={u.preferences.length ? u.preferences.map((p) => PREFERENCE_LABEL[p]).join(', ') : 'Commute mode and ride preferences'} onClick={() => nav('/profile/preferences')} />
          <ListRow icon={<CreditCard />} title="Payment Methods" subtitle={u.upiId ? `UPI · ${u.upiId}` : 'Add your UPI ID to receive cost-share'} onClick={() => nav('/profile/payments')} />
          <ListRow icon={<Bell />} title="Notifications" onClick={() => nav('/profile/notifications')} />
          <ListRow icon={<ShieldCheck />} title="Safety" subtitle={u.emergencyContacts?.length ? `${u.emergencyContacts.length} emergency contact` : 'Add an emergency contact'} onClick={() => nav('/profile/safety')} />
          <ListRow icon={<SettingsIcon />} title="Settings" onClick={() => nav('/settings')} />
          <ListRow icon={<LifeBuoy />} title="Help & Support" onClick={() => nav('/profile/help')} />
        </div>

        <Button variant="secondary" block icon={<LogOut />} onClick={() => setSignOut(true)}>
          Log out
        </Button>
        <p className="t-caption t-muted t-center" style={{ fontWeight: 400 }}>
          RideSync AI · v0.1 · Made for the VIT community
        </p>
      </div>
      <ConfirmDialog
        open={signOut}
        title="Log out of RideSync?"
        body="You can log back in anytime with your college account."
        confirmLabel="Log out"
        cancelLabel="Stay logged in"
        onConfirm={async () => {
          await auth.logout()
          nav('/welcome', { replace: true })
        }}
        onClose={() => setSignOut(false)}
      />
    </Page>
  )
}

/* ==========================================================================
   Profile sections
   ========================================================================== */

export function ProfileSection() {
  const { section } = useParams()
  switch (section) {
    case 'personal':
      return <Personal />
    case 'vehicle':
      return <VehicleSection />
    case 'preferences':
      return <Preferences />
    case 'payments':
      return <PaymentMethods />
    case 'notifications':
      return <NotificationSettings />
    case 'safety':
      return <Safety />
    case 'help':
      return <Help />
    default:
      return <Navigate to="/profile" replace />
  }
}

function Personal() {
  const { user } = useMe()
  const u = user!
  const toast = useToast()
  const [name, setName] = useState(u.name)
  const [phone, setPhone] = useState(u.phone)
  const [studentId, setStudentId] = useState(u.studentId)
  const [programme, setProgramme] = useState(u.programme ?? '')
  const [gender, setGender] = useState<Gender>(u.gender)
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const [saving, setSaving] = useState(false)
  async function save() {
    const errs = { name: name.trim().length >= 3 ? null : 'Enter your full name', phone: validatePhone(phone), studentId: validateStudentId(studentId) }
    setErrors(errs)
    if (Object.values(errs).some(Boolean)) return
    setSaving(true)
    try {
      await updateMe({ name: name.trim(), phone, studentId, programme: programme.trim(), gender })
      toast({ tone: 'success', message: 'Saved' })
    } catch (err) {
      if (err instanceof ApiError && err.field) setErrors({ [err.field]: err.message })
      else toast({ tone: 'error', message: err instanceof ApiError ? err.message : 'Couldn’t save' })
    } finally {
      setSaving(false)
    }
  }
  return (
    <Page title="Personal Information" backTo="/profile" narrow footer={<Button size="lg" block loading={saving} onClick={save}>Save changes</Button>}>
      <div className="stack gap-4">
        <PhotoPicker name={u.name} photo={u.photo} />
        <Field label="Full name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} leading={<UserRound />} />
        <Field label="College email" value={u.email} disabled leading={<Mail />} hint="Verified at sign-in. This can’t be changed." />
        <Field label="Student ID / roll number" value={studentId} onChange={(e) => setStudentId(e.target.value.toUpperCase())} error={errors.studentId} />
        <Field label="Branch & year" value={programme} onChange={(e) => setProgramme(e.target.value)} placeholder="e.g. Computer Engineering · TE" />
        <Field label="Mobile number" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} leading={<Phone />} hint="Shared only with your driver or riders on confirmed rides." />
        <div className="field">
          <span className="field__label">Gender</span>
          <Segmented<Gender>
            label="Gender"
            value={gender}
            onChange={setGender}
            options={[
              { value: 'female', label: 'Female' },
              { value: 'male', label: 'Male' },
              { value: 'other', label: 'Other' },
              { value: 'undisclosed', label: 'Skip' },
            ]}
          />
          <span className="field__hint">Used only for Female-friendly ride matching. Never shown on your profile.</span>
        </div>
      </div>
    </Page>
  )
}

function VehicleSection() {
  const { user } = useMe()
  const u = user!
  const toast = useToast()
  const [remove, setRemove] = useState(false)
  return (
    <Page title="Vehicle Information" backTo="/profile" narrow>
      <div className="stack gap-6">
        {u.vehicle && (
          <div className="vehicle-row card card--pad">
            <span className="list-row__icon">
              <CarFront />
            </span>
            <span className="stack grow">
              <span className="t-body t-strong">
                {u.vehicle.make} {u.vehicle.model}
              </span>
              <span className="t-sm t-muted">{u.vehicle.color}</span>
            </span>
            <Plate>{u.vehicle.plate}</Plate>
          </div>
        )}
        <VehicleForm
          initial={u.vehicle}
          submitLabel={u.vehicle ? 'Save changes' : 'Add car'}
          onSubmit={async (v) => {
            await saveVehicle(v)
            toast({ tone: 'success', message: 'Vehicle saved' })
          }}
          secondary={
            u.vehicle ? (
              <Button variant="danger-ghost" block icon={<Trash />} onClick={() => setRemove(true)}>
                Remove vehicle
              </Button>
            ) : undefined
          }
        />
      </div>
      <ConfirmDialog
        open={remove}
        title="Remove your vehicle?"
        body="You won’t be able to offer rides until you add a car again."
        confirmLabel="Remove vehicle"
        destructive
        onConfirm={async () => {
          try {
            await removeVehicle()
            toast({ tone: 'info', message: 'Vehicle removed' })
          } catch (e) {
            toast({ tone: 'error', message: e instanceof ApiError ? e.message : 'Couldn’t remove vehicle' })
          }
          setRemove(false)
        }}
        onClose={() => setRemove(false)}
      />
    </Page>
  )
}

const ALL_PREFS: { value: RidePreference; icon: React.ReactNode }[] = [...PREF_OPTIONS, { value: 'ac', icon: <Snowflake /> }, { value: 'music_ok', icon: <Music /> }]

function Preferences() {
  const { user } = useMe()
  const u = user!
  const toast = useToast()
  const set = async (patch: Parameters<typeof updateMe>[0]) => {
    try {
      await updateMe(patch)
    } catch (e) {
      toast({ tone: 'error', message: e instanceof ApiError ? e.message : 'Couldn’t save' })
    }
  }
  return (
    <Page title="Preferences" backTo="/profile" narrow>
      <div className="stack gap-8">
        <section className="stack gap-3">
          <h2 className="section__title" style={{ padding: 0 }}>
            How you commute
          </h2>
          <Segmented<CommuteMode>
            label="Commute mode"
            value={u.commute ?? 'both'}
            onChange={(c) => set({ commute: c })}
            options={[
              { value: 'driver', label: 'I have a car' },
              { value: 'rider', label: 'I need a ride' },
              { value: 'both', label: 'Both' },
            ]}
          />
          {u.commute !== 'rider' && !u.vehicle && <Notice tone="warning">Add your vehicle to start offering rides.</Notice>}
        </section>
        <section className="stack gap-3">
          <div className="stack gap-1">
            <h2 className="section__title" style={{ padding: 0 }}>
              Ride preferences
            </h2>
            <span className="t-sm t-muted">Applied by default when you search or offer. AI matching scores rides higher when they fit.</span>
          </div>
          <div className="row wrap gap-2">
            {ALL_PREFS.map((o) => (
              <Chip
                key={o.value}
                icon={o.icon}
                selected={u.preferences.includes(o.value)}
                onClick={() => set({ preferences: u.preferences.includes(o.value) ? u.preferences.filter((x) => x !== o.value) : [...u.preferences, o.value] })}
              >
                {PREFERENCE_LABEL[o.value]}
              </Chip>
            ))}
          </div>
        </section>
      </div>
    </Page>
  )
}

function PaymentMethods() {
  const { user } = useMe()
  const u = user!
  const toast = useToast()
  const [upi, setUpi] = useState(u.upiId ?? '')
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  async function save() {
    if (upi.trim() && !/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(upi.trim())) return setErr('UPI IDs look like name@bank')
    setSaving(true)
    try {
      await updateMe({ upiId: upi.trim() })
      toast({ tone: 'success', message: upi.trim() ? 'UPI ID saved' : 'UPI ID removed' })
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Couldn’t save')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Page title="Payment Methods" backTo="/profile" narrow footer={<Button size="lg" block loading={saving} onClick={save}>Save</Button>}>
      <div className="stack gap-6">
        <div className="stack gap-2">
          <h2 className="t-h3">Receive cost-share</h2>
          <p className="t-sm t-muted">When you drive, riders pay you directly from Google Pay, PhonePe, Paytm or any UPI app using this ID.</p>
        </div>
        <Field label="Your UPI ID" placeholder="yourname@okaxis" value={upi} onChange={(e) => { setUpi(e.target.value); setErr(null) }} error={err} />
        <div className="stack gap-2">
          <h2 className="t-h3">Paying for rides</h2>
          <p className="t-sm t-muted">After a driver accepts, pay them by UPI (we open your UPI app with the amount filled in) or in cash at pickup.</p>
        </div>
        <Notice icon={<ShieldCheck />}>RideSync never holds your money, never asks for your UPI PIN, and charges no fees.</Notice>
      </div>
    </Page>
  )
}

function NotificationSettings() {
  const [perm, setPerm] = useState(notificationPermission())
  return (
    <Page title="Notifications" backTo="/profile" narrow>
      <div className="stack gap-6">
        {perm === 'granted' ? (
          <Notice tone="success" icon={<Bell />} title="Notifications are on">
            You’ll get alerts for requests, acceptances, arrivals and messages while RideSync is open in a tab.
          </Notice>
        ) : (
          <Notice
            tone={perm === 'denied' ? 'warning' : 'ai'}
            icon={<Bell />}
            title={perm === 'denied' ? 'Blocked in your browser' : perm === 'unsupported' ? 'Not supported on this browser' : 'Notifications are off'}
            action={perm === 'unknown' ? <Button size="sm" variant="tonal" onClick={async () => setPerm(await requestNotificationPermission())}>Allow</Button> : undefined}
          >
            {perm === 'denied' ? 'Allow notifications for this site in your browser settings to get alerts.' : 'You’ll still see every update inside the app.'}
          </Notice>
        )}
        <div className="list">
          <ListRow title="Ride updates" subtitle="Requests, acceptances, arrivals, cancellations" trailing={<span className="t-sm t-muted">Always on</span>} />
          <ListRow title="Messages" subtitle="Chat from drivers and riders" trailing={<span className="t-sm t-muted">Always on</span>} />
        </div>
      </div>
    </Page>
  )
}

function Safety() {
  const { user } = useMe()
  const u = user!
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const contacts = u.emergencyContacts ?? []
  return (
    <Page title="Safety" backTo="/profile" narrow>
      <div className="stack gap-6">
        <div className="safety-list">
          <div className="row row--top gap-3">
            <ShieldCheck size={20} className="t-primary" style={{ flex: 'none' }} />
            <span className="t-sm t-secondary">Every driver and rider signed in with a verified @{u.email.split('@')[1]} college account.</span>
          </div>
          <div className="row row--top gap-3">
            <MessageCircle size={20} className="t-primary" style={{ flex: 'none' }} />
            <span className="t-sm t-secondary">Phone numbers are only shared with your co-riders for confirmed rides.</span>
          </div>
          <div className="row row--top gap-3">
            <Layers size={20} className="t-primary" style={{ flex: 'none' }} />
            <span className="t-sm t-secondary">During a ride you can share your trip, call 112, or text your emergency contacts your live location in one tap.</span>
          </div>
        </div>

        <section className="section">
          <h2 className="section__title">Emergency contacts</h2>
          <div className="list">
            {contacts.map((c, i) => (
              <ListRow
                key={i}
                icon={<UserRound />}
                title={c.name}
                subtitle={c.phone}
                trailing={
                  <button className="t-sm t-strong" style={{ color: 'var(--error-600)' }} onClick={() => updateMe({ emergencyContacts: contacts.filter((_, j) => j !== i) })}>
                    Remove
                  </button>
                }
              />
            ))}
          </div>
          {contacts.length < 3 && (
            <Button variant="secondary" block icon={<Plus />} onClick={() => setOpen(true)}>
              Add emergency contact
            </Button>
          )}
        </section>

      </div>
      <ModalSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Add emergency contact"
        footer={
          <Button
            size="lg"
            block
            onClick={async () => {
              const e = !name.trim() ? 'Enter a name' : validatePhone(phone)
              setErr(e)
              if (e) return
              await updateMe({ emergencyContacts: [...contacts, { name: name.trim(), phone: phone.replace(/\D/g, '').slice(-10) }] })
              setOpen(false)
              setName('')
              setPhone('')
              toast({ tone: 'success', message: 'Emergency contact added' })
            }}
          >
            Save contact
          </Button>
        }
      >
        <div className="stack gap-4">
          <Field label="Name" placeholder="e.g. Parent or guardian" value={name} onChange={(e) => setName(e.target.value)} />
          <Field label="Mobile number" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={err} />
        </div>
      </ModalSheet>
    </Page>
  )
}

const FAQ = [
  ['How is the fare decided?', 'It works exactly like BlaBlaCar. RideSync suggests a price per seat from the distance (about ₹1.85 per km at today’s petrol price; it follows the real petrol price automatically), and the driver can set anything from half to one and a half times that, never below ₹30. You see the price before you book and it never changes. If you ride only part of the way, you pay for your part. There is no platform fee.'],
  ['What does the AI match score mean?', 'It combines how much of your route the driver covers, how close they pass your pickup, timing, your preferences and the driver’s reliability. Tap “Why this ride?” on any ride to see the breakdown.'],
  ['What if my driver cancels?', 'You’re notified straight away. If you paid online, the money is refunded automatically; if you paid the driver by UPI, ask them to send it back. Search again to find the next best match.'],
  ['Who can join RideSync?', 'Only VIT students who sign in with their verified @vit.edu.in college email and a valid student ID.'],
  ['How do I pay?', 'After the driver accepts, pay them directly by UPI (we open GPay, PhonePe or Paytm with the amount filled in), in cash at pickup, or online when RideSync has online payments turned on.'],
  ['Is my phone number shared?', 'Only with your driver or riders once a seat is confirmed, and never on your public profile.'],
]

function Help() {
  const [open, setOpen] = useState<number | null>(0)
  const toast = useToast()
  return (
    <Page title="Help & Support" backTo="/profile" narrow>
      <div className="stack gap-6">
        <div className="list">
          {FAQ.map(([q, a], i) => (
            <div key={q}>
              <button type="button" className="list-row" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                <span className="list-row__icon list-row__icon--plain">
                  <CircleQuestionMark />
                </span>
                <span className="list-row__body">
                  <span className="list-row__title">{q}</span>
                </span>
                <ChevronRight size={18} style={{ transform: open === i ? 'rotate(90deg)' : undefined, transition: 'transform 200ms', color: 'var(--ink-400)' }} />
              </button>
              {open === i && <p className="t-sm t-secondary" style={{ padding: '0 0 16px 40px' }}>{a}</p>}
            </div>
          ))}
        </div>
        <div className="list">
          <ListRow icon={<MessageCircle />} title="Chat with support" subtitle="Typically replies within a few hours" onClick={() => toast({ tone: 'info', message: 'Support chat connects to your helpdesk tool in production' })} />
          <ListRow icon={<FileText />} title="Community Guidelines" onClick={() => toast({ tone: 'info', message: 'Guidelines open from your CMS in production' })} />
        </div>
      </div>
    </Page>
  )
}

/* ==========================================================================
   Settings
   ========================================================================== */

export function Settings() {
  const { user } = useMe()
  const u = user!
  const nav = useNavigate()
  const toast = useToast()
  const [del, setDel] = useState(false)
  const [deleting, setDeleting] = useState(false)
  return (
    <Page title="Settings" narrow>
      <div className="stack gap-6">
        <section className="section">
          <h2 className="section__title">Account</h2>
          <div className="list">
            <ListRow icon={<UserRound />} title="Personal Information" subtitle={u.email} onClick={() => nav('/profile/personal')} />
            <ListRow icon={<Bell />} title="Notifications" onClick={() => nav('/profile/notifications')} />
            <ListRow icon={<ShieldCheck />} title="Safety" onClick={() => nav('/profile/safety')} />
          </div>
        </section>

        <section className="section">
          <h2 className="section__title">Product</h2>
          <div className="list">
            <ListRow icon={<Palette />} title="Design system" subtitle="Tokens and components" onClick={() => nav('/design-system')} />
            <ListRow icon={<Layers />} title="Screen states" subtitle="Empty, loading and error states" onClick={() => nav('/states')} />
          </div>
        </section>

        <section className="section">
          <h2 className="section__title">Legal</h2>
          <div className="list">
            <ListRow icon={<ShieldCheck />} title="Privacy Policy" subtitle="What we collect and your rights" onClick={() => nav('/privacy')} />
            <ListRow icon={<FileText />} title="Terms of Use" subtitle="Rules for drivers and riders" onClick={() => nav('/terms')} />
          </div>
        </section>

        <section className="section">
          <h2 className="section__title">Danger zone</h2>
          <div className="list">
            <ListRow
              icon={<LogOut />}
              title="Log out"
              onClick={async () => {
                await auth.logout()
                nav('/welcome', { replace: true })
              }}
            />
            <ListRow icon={<Trash />} title="Delete account" danger onClick={() => setDel(true)} />
          </div>
        </section>
      </div>
      <ConfirmDialog
        open={del}
        title="Delete your account?"
        body="Your profile, phone number and car are removed permanently. Upcoming rides you offer are cancelled and riders are notified. This can’t be undone."
        confirmLabel="Delete account"
        cancelLabel="Keep my account"
        destructive
        loading={deleting}
        onConfirm={async () => {
          setDeleting(true)
          try {
            await deleteAccount()
            nav('/welcome', { replace: true })
          } catch (e) {
            toast({ tone: 'error', message: e instanceof ApiError ? e.message : 'Couldn’t delete account' })
            setDeleting(false)
          }
        }}
        onClose={() => setDel(false)}
      />
    </Page>
  )
}
