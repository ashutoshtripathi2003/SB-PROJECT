import { ArrowDownUp, Calendar, Clock, Users } from 'lucide-react'
import { useState } from 'react'
import { isoDate } from '@/lib/format'
import { MAX_SEATS } from '@/lib/validation'
import type { Place } from '@/lib/types'
import { PlacePicker } from './PlacePicker'
import { IconButton, cx } from './ui'

export type TripDraft = { pickup: Place | null; drop: Place | null; date: string; time: string; seats: number }

/**
 * From / To / When / Seats. The route box keeps both ends visible together,
 * with a swap control — the most common correction riders make.
 */
export function TripForm({
  value,
  onChange,
  seatsLabel = 'Seats',
  maxSeats = MAX_SEATS,
  errors = {},
}: {
  value: TripDraft
  onChange: (v: TripDraft) => void
  seatsLabel?: string
  maxSeats?: number
  errors?: { pickup?: string | null; drop?: string | null; time?: string | null }
}) {
  const [picking, setPicking] = useState<'pickup' | 'drop' | null>(null)
  const today = isoDate(new Date())
  const max = isoDate(new Date(Date.now() + 30 * 86_400_000))

  return (
    <div className="stack gap-3">
      <div className={cx('routebox', (errors.pickup || errors.drop) && 'is-invalid')}>
        <div className="routebox__rail" aria-hidden>
          <span className="stops__dot" />
          <span className="routebox__line" />
          <span className="stops__dot stops__dot--end" />
        </div>
        <div className="routebox__fields">
          <button type="button" className="routebox__field" onClick={() => setPicking('pickup')}>
            <span className="routebox__label">From</span>
            <span className={cx('routebox__value', !value.pickup && 'is-placeholder')}>{value.pickup?.name ?? 'Pickup location'}</span>
          </button>
          <span className="routebox__sep" />
          <button type="button" className="routebox__field" onClick={() => setPicking('drop')}>
            <span className="routebox__label">To</span>
            <span className={cx('routebox__value', !value.drop && 'is-placeholder')}>{value.drop?.name ?? 'Where are you going?'}</span>
          </button>
        </div>
        <IconButton
          type="button"
          label="Swap pickup and destination"
          className="routebox__swap"
          disabled={!value.pickup && !value.drop}
          onClick={() => onChange({ ...value, pickup: value.drop, drop: value.pickup })}
        >
          <ArrowDownUp />
        </IconButton>
      </div>
      {(errors.pickup || errors.drop) && (
        <span className="field__error" role="alert">
          {errors.pickup ?? errors.drop}
        </span>
      )}

      <div className="when-row">
        <label className="pill-input">
          <Calendar />
          <span className="sr-only">Date</span>
          <input type="date" value={value.date} min={today} max={max} onChange={(e) => e.target.value && onChange({ ...value, date: e.target.value })} />
          <span className="pill-input__text">{dateText(value.date)}</span>
        </label>
        <label className={cx('pill-input', errors.time && 'is-invalid')}>
          <Clock />
          <span className="sr-only">Time</span>
          <input type="time" value={value.time} step={300} onChange={(e) => e.target.value && onChange({ ...value, time: e.target.value })} />
          <span className="pill-input__text">{timeText(value.time)}</span>
        </label>
        <div className="pill-input pill-input--seats">
          <Users />
          <span className="sr-only">{seatsLabel}</span>
          <button type="button" aria-label={`Fewer ${seatsLabel.toLowerCase()}`} disabled={value.seats <= 1} onClick={() => onChange({ ...value, seats: value.seats - 1 })}>
            −
          </button>
          <span className="pill-input__text tabular" aria-live="polite">
            {value.seats}
          </span>
          <button type="button" aria-label={`More ${seatsLabel.toLowerCase()}`} disabled={value.seats >= maxSeats} onClick={() => onChange({ ...value, seats: value.seats + 1 })}>
            +
          </button>
        </div>
      </div>
      {errors.time && (
        <span className="field__error" role="alert">
          {errors.time}
        </span>
      )}

      <PlacePicker
        open={picking !== null}
        title={picking === 'pickup' ? 'Pickup location' : 'Destination'}
        onClose={() => setPicking(null)}
        onPick={(p) => {
          onChange({ ...value, [picking!]: p })
          setPicking(null)
        }}
      />
    </div>
  )
}

function dateText(d: string) {
  const today = isoDate(new Date())
  const tomorrow = isoDate(new Date(Date.now() + 86_400_000))
  if (d === today) return 'Today'
  if (d === tomorrow) return 'Tomorrow'
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function timeText(t: string) {
  const [h, m] = t.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m)
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()
}

export function validateTrip(v: TripDraft) {
  const errors: { pickup?: string | null; drop?: string | null; time?: string | null } = {}
  if (!v.pickup) errors.pickup = 'Choose a pickup location'
  else if (!v.drop) errors.drop = 'Choose where you’re going'
  else if (Math.abs(v.pickup.lat - v.drop.lat) + Math.abs(v.pickup.lng - v.drop.lng) < 0.003) errors.drop = 'Pickup and destination are the same place'
  const when = new Date(`${v.date}T${v.time}:00`)
  if (when.getTime() < Date.now() - 5 * 60_000) errors.time = 'Pick a time in the future'
  return errors
}
