import { useState, type FormEvent, type ReactNode } from 'react'
import type { Vehicle } from '@/lib/types'
import { FUEL_SPECS, mileageUnit } from '@/lib/fuel'
import { MAX_SEATS, formatPlate, validatePlate } from '@/lib/validation'
import { Button, Field, Notice, Segmented, Stepper } from './ui'

/** `mileage`: the car's own km per litre (kg, kWh) in city traffic; null clears it. */
export type VehicleDraft = Omit<Vehicle, 'id' | 'mileage'> & { mileage?: number | null }

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
  const [mileage, setMileage] = useState(initial?.mileage != null ? String(initial.mileage) : '')
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const spec = FUEL_SPECS[v.fuel]
  function mileageError() {
    if (!mileage.trim()) return null
    const n = Number(mileage)
    return Number.isFinite(n) && n >= spec.mileage.min && n <= spec.mileage.max ? null : `Between ${spec.mileage.min} and ${spec.mileage.max} ${mileageUnit(v.fuel)}, or leave it empty`
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const errs = {
      make: v.make.trim() ? null : 'Enter the make, e.g. Honda',
      model: v.model.trim() ? null : 'Enter the model, e.g. City',
      color: v.color.trim() ? null : 'Enter the colour',
      plate: validatePlate(v.plate),
      mileage: mileageError(),
    }
    setErrors(errs)
    if (Object.values(errs).some(Boolean)) return
    setSaving(true)
    setFormError(null)
    try {
      await onSubmit({ ...v, make: v.make.trim(), model: v.model.trim(), color: v.color.trim(), plate: formatPlate(v.plate), mileage: mileage.trim() ? Number(mileage) : null })
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
        <Field label="Model" placeholder="City" value={v.model} onChange={(e) => setV({ ...v, model: e.target.value })} error={errors.model} />
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
        <Stepper label="Seats" value={v.seats} min={1} max={MAX_SEATS} onChange={(n) => setV({ ...v, seats: n })} />
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
      <Field
        label={`Mileage in city traffic (${mileageUnit(v.fuel)}) — optional`}
        inputMode="decimal"
        placeholder={`Typical: ${spec.kmPerUnit}`}
        value={mileage}
        onChange={(e) => setMileage(e.target.value.replace(/[^0-9.]/g, ''))}
        error={errors.mileage}
        hint={`What your car really gives in Mumbai traffic. It sets the fuel cost riders share; leave it empty to use a typical ${spec.label.toLowerCase()} car (${spec.kmPerUnit} ${mileageUnit(v.fuel)}).`}
      />
      <div className="stack gap-2" style={{ marginTop: 8 }}>
        <Button type="submit" size="lg" block loading={saving}>
          {submitLabel}
        </Button>
        {secondary}
      </div>
    </form>
  )
}
