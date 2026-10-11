import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Vehicle } from '@/lib/types'
import { formatPlate, validatePlate } from '@/lib/validation'
import { cars, type CarInfo } from '@/services/api'
import { Button, Field, Notice, Segmented, Stepper } from './ui'

export type VehicleDraft = Omit<Vehicle, 'id'>

/** Typical mileage when the driver leaves a box blank (same as the server's DEFAULT_MILEAGE). */
const TYPICAL: Record<Vehicle['fuel'], { smooth: number; city: number; traffic: number }> = {
  petrol: { smooth: 18, city: 14, traffic: 7 },
  diesel: { smooth: 20, city: 16, traffic: 8 },
  cng: { smooth: 26, city: 22, traffic: 11 },
  ev: { smooth: 6, city: 7, traffic: 7 },
}

export function VehicleForm({
  initial,
  onSubmit,
  submitLabel = 'Save',
  secondary,
}: {
  initial?: Vehicle
  onSubmit: (v: VehicleDraft) => Promise<void>
  submitLabel?: string
  secondary?: ReactNode
}) {
  const [v, setV] = useState<VehicleDraft>({
    make: initial?.make ?? '',
    model: initial?.model ?? '',
    color: initial?.color ?? '',
    plate: initial?.plate ?? '',
    seats: initial?.seats ?? 3,
    fuel: initial?.fuel ?? 'petrol',
  })
  // The car's own mileage per condition (optional): makes the trip cost, and so everyone's share, exact.
  const [mileage, setMileage] = useState({
    smooth: initial?.mileage?.smooth ? String(initial.mileage.smooth) : '',
    city: initial?.mileage?.city ? String(initial.mileage.city) : '',
    traffic: initial?.mileage?.traffic ? String(initial.mileage.traffic) : '',
  })
  // RideSync knows the mileage of popular models; typing your own is optional.
  const [ownOpen, setOwnOpen] = useState(!!initial?.mileage)
  const [known, setKnown] = useState<{ match: string | null; mileage: { smooth: number; city: number; traffic: number } } | null>(null)
  const [models, setModels] = useState<CarInfo[]>([])
  useEffect(() => {
    cars.list().then(setModels).catch(() => {})
  }, [])
  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      cars
        .mileage(v.make, v.model, v.fuel)
        .then((r) => alive && setKnown(r))
        .catch(() => {})
    }, 300)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [v.make, v.model, v.fuel])
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const unit = v.fuel === 'ev' ? 'km/kWh' : v.fuel === 'cng' ? 'km/kg' : 'km/L'

  async function submit(e: FormEvent) {
    e.preventDefault()
    const errs = {
      make: v.make.trim() ? null : 'Enter the make, e.g. Honda',
      model: v.model.trim() ? null : 'Enter the model, e.g. City',
      color: v.color.trim() ? null : 'Enter the colour',
      plate: validatePlate(v.plate),
      ...Object.fromEntries((['smooth', 'city', 'traffic'] as const).map((k) => [`m_${k}`, ownOpen && mileage[k] && !(Number(mileage[k]) >= 1 && Number(mileage[k]) <= 60) ? 'Between 1 and 60' : null])),
    }
    setErrors(errs)
    if (Object.values(errs).some(Boolean)) return
    setSaving(true)
    setFormError(null)
    try {
      const m = ownOpen ? { smooth: Number(mileage.smooth) || undefined, city: Number(mileage.city) || undefined, traffic: Number(mileage.traffic) || undefined } : {}
      await onSubmit({ ...v, make: v.make.trim(), model: v.model.trim(), color: v.color.trim(), plate: formatPlate(v.plate), mileage: m.smooth || m.city || m.traffic ? m : undefined })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Couldn’t save your car.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="stack gap-4" onSubmit={submit} noValidate>
      {formError && <Notice tone="error">{formError}</Notice>}
      <div className="split split--2" style={{ gap: 16 }}>
        <Field label="Make" placeholder="Honda" value={v.make} onChange={(e) => setV({ ...v, make: e.target.value })} error={errors.make} />
        <Field label="Model" placeholder="City" list="ridesync-car-models" value={v.model} onChange={(e) => setV({ ...v, model: e.target.value })} error={errors.model} />
        <datalist id="ridesync-car-models">
          {[...new Set(models.filter((c) => !v.make.trim() || c.make.toLowerCase().startsWith(v.make.trim().toLowerCase().slice(0, 3))).map((c) => c.model))].map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>
      <div className="split split--2" style={{ gap: 16 }}>
        <Field label="Colour" placeholder="White" value={v.color} onChange={(e) => setV({ ...v, color: e.target.value })} error={errors.color} />
        <Field
          label="Registration number"
          placeholder="MH 01 AB 1234"
          autoCapitalize="characters"
          value={v.plate}
          onChange={(e) => setV({ ...v, plate: e.target.value.toUpperCase() })}
          onBlur={() => v.plate && setV((x) => ({ ...x, plate: formatPlate(x.plate) }))}
          error={errors.plate}
        />
      </div>
      <div className="row row--between gap-4" style={{ padding: '4px 0' }}>
        <div className="stack">
          <span className="t-body t-strong">Seats for riders</span>
          <span className="t-sm t-muted">Not counting the driver</span>
        </div>
        <Stepper label="Seats" value={v.seats} min={1} max={6} onChange={(n) => setV({ ...v, seats: n })} />
      </div>
      <div className="field">
        <span className="field__label">Fuel</span>
        <Segmented
          label="Fuel type"
          value={v.fuel}
          onChange={(fuel) => setV({ ...v, fuel })}
          options={[
            { value: 'petrol', label: 'Petrol' },
            { value: 'diesel', label: 'Diesel' },
            { value: 'cng', label: 'CNG' },
            { value: 'ev', label: 'Electric' },
          ]}
        />
      </div>
      <div className="field">
        <span className="field__label">Mileage</span>
        {known && (
          <span className="t-sm">
            {known.match ? `RideSync uses typical ${known.match} (${v.fuel}) figures: ` : `Typical ${v.fuel === 'ev' ? 'electric' : v.fuel} car figures: `}
            {known.mileage.smooth} open roads · {known.mileage.city} city · {known.mileage.traffic} heavy traffic ({unit}). Nothing to type.
          </span>
        )}
        <button type="button" className="t-sm t-strong t-primary" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => setOwnOpen((o) => !o)}>
          {ownOpen ? 'Use the typical figures instead' : 'My car differs — enter my own (optional)'}
        </button>
        {ownOpen && (
          <>
            <div className="split split--3" style={{ gap: 12, marginTop: 8 }}>
              {(
                [
                  ['smooth', 'Open roads'],
                  ['city', 'City'],
                  ['traffic', 'Heavy traffic'],
                ] as const
              ).map(([k, label]) => (
                <Field
                  key={k}
                  label={label}
                  inputMode="decimal"
                  placeholder={String(known?.mileage[k] ?? TYPICAL[v.fuel][k])}
                  value={mileage[k]}
                  onChange={(e) => setMileage({ ...mileage, [k]: e.target.value.replace(/[^0-9.]/g, '').slice(0, 5) })}
                  trailing={<span className="t-caption t-muted" style={{ paddingRight: 10 }}>{unit}</span>}
                  error={errors[`m_${k}`]}
                />
              ))}
            </div>
            <span className="field__hint">Fuel burns faster in traffic, so the trip cost uses the right figure for each part of the route. Blank boxes use the typical figures.</span>
          </>
        )}
      </div>
      <div className="stack gap-2" style={{ marginTop: 8 }}>
        <Button type="submit" size="lg" block loading={saving}>
          {submitLabel}
        </Button>
        {secondary}
      </div>
    </form>
  )
}
