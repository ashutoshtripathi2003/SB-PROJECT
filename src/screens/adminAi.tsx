import { Brain, Database, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { NetworkError } from '@/components/States'
import { ConfirmDialog } from '@/components/Sheet'
import { useToast } from '@/components/Toast'
import { Badge, Button, RideCardSkeleton } from '@/components/ui'
import { relative } from '@/lib/format'
import { ApiError, admin, useQuery, type MlModel, type MlReport } from '@/services/api'

/** What each model does for RideSync, in plain words (for the dashboard and the viva). */
const WHAT: Record<MlModel['name'], string> = {
  match: 'Predicts how likely a driver is to accept a rider’s request, and ranks search results by it together with the match score.',
  risk: 'Predicts how likely a booking is to end in a rider cancellation or no-show; drivers see a reliability hint on requests.',
  eta: 'Predicts the real pickup→drop time from distance, time of day and the TomTom / Ola / Mappls estimates.',
  demand: 'Forecasts how many ride requests to expect each hour for the next 24 hours, and the busiest pickup areas.',
}

const LABEL: Record<string, string> = {
  auc: 'AUC (ranking quality)',
  accuracy: 'Accuracy',
  precision: 'Precision',
  recall: 'Recall',
  maeMin: 'Average error',
  rmseMin: 'RMSE',
  r2: 'R² (variance explained)',
  maeTripsPerHour: 'Average error (requests/hour)',
  next24h: 'Requests expected next 24 h',
  tomtomMaeMin: 'TomTom alone — average error',
}
const fmt = (k: string, v: number | null) => (v === null ? '—' : k.endsWith('Min') ? `${v} min` : ['auc', 'accuracy', 'precision', 'recall'].includes(k) ? `${Math.round(v * 100)}%` : String(v))

export function AiTab() {
  const toast = useToast()
  const q = useQuery<MlReport>('/admin/ml')
  const [busy, setBusy] = useState<'train' | 'add' | 'remove' | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  async function act(kind: 'train' | 'add' | 'remove') {
    setBusy(kind)
    try {
      if (kind === 'train') await admin.train()
      if (kind === 'add') {
        const r = await admin.addDemo()
        toast({ tone: 'success', message: `Demo data added: ${r.demo.rides} rides, ${r.demo.bookings} bookings. Models retrained.` })
      }
      if (kind === 'remove') {
        const r = await admin.removeDemo()
        toast({ tone: 'success', message: `Removed ${r.removed.rides} demo rides and ${r.removed.users} demo students. Real data untouched.` })
      }
      await q.reload()
    } catch (e) {
      toast({ tone: 'error', message: e instanceof ApiError ? e.message : 'Something went wrong' })
    } finally {
      setBusy(null)
      setConfirmRemove(false)
    }
  }

  if (q.loading) return <RideCardSkeleton />
  if (!q.data) return <NetworkError onRetry={q.reload} />
  const { models, forecast, demo, assistant } = q.data
  const demoOn = demo.users > 0

  return (
    <div className="stack gap-6">
      <div className="row row--between wrap gap-2">
        <div className="stack gap-1">
          <h1 className="t-h2">AI insights</h1>
          <span className="t-sm t-muted">Machine-learning models trained on RideSync’s own data · retrained every 30 minutes</span>
        </div>
        <Button size="sm" variant="secondary" icon={<RefreshCw />} loading={busy === 'train'} onClick={() => act('train')}>
          Retrain now
        </Button>
      </div>

      <section className={`admin-group demo-box${demoOn ? ' is-on' : ''}`}>
        <div className="row gap-3">
          <span className="demo-box__icon">
            <Database />
          </span>
          <span className="stack grow gap-1" style={{ minWidth: 0 }}>
            <span className="t-body t-strong">Demo data {demoOn ? 'is ON' : 'is off'}</span>
            <span className="t-sm t-muted">
              {demoOn
                ? `${demo.users} demo students · ${demo.rides} past rides · ${demo.bookings} bookings. The models are partly trained on this sample data — remove it before real use.`
                : 'For presentations: adds 8 weeks of realistic past rides (tagged “demo”) so every model trains and shows accuracy. Removing it deletes only demo data.'}
            </span>
          </span>
        </div>
        <div className="row gap-2 wrap">
          {!demoOn && (
            <Button size="sm" icon={<Database />} loading={busy === 'add'} onClick={() => act('add')}>
              Add demo data
            </Button>
          )}
          {demoOn && (
            <Button size="sm" variant="danger-ghost" icon={<Trash2 />} loading={busy === 'remove'} onClick={() => setConfirmRemove(true)}>
              Remove demo data
            </Button>
          )}
        </div>
      </section>

      <div className="ai-grid">
        {models.map((m) => (
          <ModelCard key={m.name} m={m} />
        ))}
        {assistant && <AssistantCard a={assistant} />}
      </div>

      {forecast && <Forecast f={forecast} />}

      <ConfirmDialog
        open={confirmRemove}
        title="Remove all demo data?"
        body={`Deletes the ${demo.users} demo students, ${demo.rides} demo rides and ${demo.bookings} demo bookings. Real students and rides are not touched.`}
        confirmLabel="Remove demo data"
        destructive
        loading={busy === 'remove'}
        onConfirm={() => act('remove')}
        onClose={() => setConfirmRemove(false)}
      />
    </div>
  )
}

function ModelCard({ m }: { m: MlModel }) {
  const trained = m.status === 'trained'
  const pct = Math.min(100, Math.round((m.samples / m.needed) * 100))
  return (
    <section className="admin-group ai-card">
      <div className="row row--between gap-2">
        <span className="row gap-2" style={{ minWidth: 0 }}>
          <span className="ai-card__icon">
            <Brain />
          </span>
          <span className="stack" style={{ minWidth: 0 }}>
            <span className="t-body t-strong">{m.title}</span>
            <span className="t-caption t-muted" style={{ fontWeight: 400 }}>
              {m.method}
            </span>
          </span>
        </span>
        <Badge tone={trained ? 'success' : 'warning'}>{trained ? 'Trained' : 'Learning'}</Badge>
      </div>
      <p className="t-sm t-secondary">{WHAT[m.name]}</p>

      {!trained ? (
        <div className="stack gap-2">
          <div className="ai-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Training data collected">
            <i style={{ width: `${pct}%` }} />
          </div>
          <span className="t-sm t-muted">
            {m.samples} of {m.needed} examples needed. {m.note}
          </span>
        </div>
      ) : (
        <>
          <dl className="ai-metrics">
            {Object.entries(m.metrics ?? {}).map(([k, v]) => (
              <div key={k}>
                <dt>{LABEL[k] ?? k}</dt>
                <dd className="tabular">{fmt(k, v)}</dd>
              </div>
            ))}
            {Object.entries(m.baseline ?? {}).map(([k, v]) => (
              <div key={k} className="is-baseline">
                <dt>{k === 'auc' ? 'Rule-based baseline AUC' : (LABEL[k] ?? k)}</dt>
                <dd className="tabular">{fmt(k, v)}</dd>
              </div>
            ))}
          </dl>
          {m.importance && m.importance.length > 0 && (
            <div className="stack gap-2">
              <span className="t-sm t-strong">What the model relies on most</span>
              <ul className="ai-bars">
                {m.importance.slice(0, 5).map((f) => (
                  <li key={f.feature}>
                    <span className="ai-bars__label">
                      {f.feature} <span className="t-muted">{f.direction === 'up' ? '↑' : '↓'}</span>
                    </span>
                    <span className="ai-bars__track">
                      <i style={{ width: `${Math.max(3, f.weight * 100)}%` }} />
                    </span>
                    <span className="ai-bars__value tabular">{Math.round(f.weight * 100)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <span className="t-caption t-muted" style={{ fontWeight: 400 }}>
            Trained on {m.samples} examples · tested on the newest 20% it never saw · {m.trainedAt ? relative(m.trainedAt).toLowerCase() : ''}
          </span>
        </>
      )}
    </section>
  )
}

function Forecast({ f }: { f: NonNullable<MlReport['forecast']> }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...f.hours.map((h) => h.expected))
  const label = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', hour12: true })
  return (
    <section className="admin-group viz">
      <div className="stack gap-1">
        <h2 className="t-h3">Expected ride requests, next 24 hours</h2>
        <span className="t-sm t-muted">
          Forecast from the same hours in past weeks · backtest error {f.backtestMae ?? '—'} requests/hour
        </span>
      </div>
      <div className="forecast" onMouseLeave={() => setHover(null)} role="img" aria-label={`Forecast: ${f.hours.map((h) => `${label(h.at)} ${h.expected}`).join(', ')}`}>
        {f.hours.map((h, i) => (
          <button type="button" key={h.at} className={`forecast__col${hover === i ? ' is-on' : ''}`} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onClick={() => setHover(i)} aria-label={`${label(h.at)}: ${h.expected} requests`}>
            <i style={{ height: `${(h.expected / max) * 100}%` }} />
            {i % 3 === 0 && <span>{label(h.at)}</span>}
          </button>
        ))}
        {hover !== null && (
          <div className="viz-tip forecast__tip" style={{ left: `${((hover + 0.5) / f.hours.length) * 100}%` }}>
            <strong>{label(f.hours[hover].at)}</strong>
            <span>{f.hours[hover].expected} requests expected</span>
          </div>
        )}
      </div>
      {f.areas.length > 0 && (
        <div className="stack gap-2">
          <span className="t-sm t-strong">Busiest pickup areas on this weekday</span>
          <div className="row wrap gap-2">
            {f.areas.map((a) => (
              <Badge key={a.area} tone="outline">
                {a.area} · {a.trips}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function AssistantCard({ a }: { a: NonNullable<MlReport['assistant']> }) {
  const max = Math.max(1, ...a.topIntents.map((t) => t.n))
  return (
    <section className="admin-group ai-card">
      <div className="row row--between gap-2">
        <span className="row gap-2" style={{ minWidth: 0 }}>
          <span className="ai-card__icon">
            <Brain />
          </span>
          <span className="stack" style={{ minWidth: 0 }}>
            <span className="t-body t-strong">RideSync Assistant (chatbot)</span>
            <span className="t-caption t-muted" style={{ fontWeight: 400 }}>
              NLP · TF-IDF + Multinomial Naive Bayes, entity extraction
            </span>
          </span>
        </span>
        <Badge tone="success">Trained</Badge>
      </div>
      <p className="t-sm t-secondary">Understands students’ messages in English and Hinglish — finds rides, checks trips and answers questions. Places, dates, times and seats are pulled out of the sentence.</p>
      <dl className="ai-metrics">
        <div>
          <dt>Accuracy (5-fold cross-validation)</dt>
          <dd className="tabular">{Math.round(a.accuracy * 100)}%</dd>
        </div>
        <div>
          <dt>Training sentences · intents</dt>
          <dd className="tabular">
            {a.examples} · {a.intents}
          </dd>
        </div>
        <div>
          <dt>Messages (30 days)</dt>
          <dd className="tabular">{a.messages30d}</dd>
        </div>
        <div>
          <dt>Understood</dt>
          <dd className="tabular">{a.understoodRate === null ? '—' : `${Math.round(a.understoodRate * 100)}%`}</dd>
        </div>
      </dl>
      {a.topIntents.length > 0 && (
        <div className="stack gap-2">
          <span className="t-sm t-strong">What students ask most</span>
          <ul className="ai-bars">
            {a.topIntents.map((t) => (
              <li key={t.intent}>
                <span className="ai-bars__label">{t.intent.replace('_', ' ')}</span>
                <span className="ai-bars__track">
                  <i style={{ width: `${(t.n / max) * 100}%` }} />
                </span>
                <span className="ai-bars__value tabular">{t.n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
