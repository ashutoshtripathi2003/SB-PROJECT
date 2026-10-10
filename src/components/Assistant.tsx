import { AnimatePresence, motion } from 'framer-motion'
import { Bot, Phone, Send, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { defaultQuery, useSearch, withInstant } from '@/state/search'
import { ApiError, assistant, type AssistantAction } from '@/services/api'

type Msg = { from: 'me' | 'bot'; text: string; actions?: AssistantAction[]; suggestions?: string[]; intent?: string; confidence?: number }

const HELLO: Msg = {
  from: 'bot',
  text: 'Hi! I’m the RideSync Assistant. Ask me in English or Hinglish — I can find rides, check your trips and answer questions.',
  suggestions: ['Ride to Andheri tomorrow 8 am', 'When is my next ride?', 'How are prices calculated?', 'kal subah Dadar jaana hai'],
}

/** Floating chat bubble: RideSync's own NLP assistant (intent classifier + entity extraction). */
export function Assistant() {
  const nav = useNavigate()
  const search = useSearch()
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([HELLO])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, busy])
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 150)
  }, [open])

  async function send(raw: string) {
    const t = raw.trim()
    if (!t || busy) return
    setText('')
    setMsgs((m) => [...m, { from: 'me', text: t }])
    setBusy(true)
    try {
      const r = await assistant.ask(t)
      setMsgs((m) => [...m, { from: 'bot', text: r.reply, actions: r.actions, suggestions: r.suggestions, intent: r.intent, confidence: r.confidence }])
    } catch (e) {
      setMsgs((m) => [...m, { from: 'bot', text: e instanceof ApiError ? e.message : 'I couldn’t reach RideSync. Check your connection.' }])
    } finally {
      setBusy(false)
    }
  }

  function act(a: AssistantAction) {
    if (a.type === 'call') return (window.location.href = `tel:${a.tel}`)
    if (a.type === 'link') {
      setOpen(false)
      return nav(a.to)
    }
    const q = defaultQuery(a.query.pickup, a.query.drop)
    const full = withInstant({ ...q, date: a.query.date ?? q.date, time: a.query.time ?? q.time, seats: a.query.seats ?? 1 })
    search.setQuery(full)
    void search.run(full)
    setOpen(false)
    nav('/find/results')
  }

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.section
            className="assistant"
            role="dialog"
            aria-label="RideSync Assistant"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          >
            <header className="assistant__head">
              <span className="assistant__avatar">
                <Bot />
              </span>
              <span className="stack grow" style={{ minWidth: 0 }}>
                <span className="t-body t-strong">RideSync Assistant</span>
                <span className="t-caption t-muted" style={{ fontWeight: 400 }}>
                  AI · understands English & Hinglish
                </span>
              </span>
              <button type="button" className="icon-btn" aria-label="Close assistant" onClick={() => setOpen(false)}>
                <X />
              </button>
            </header>
            <div className="assistant__list" ref={list} aria-live="polite">
              {msgs.map((m, i) => (
                <div key={i} className={`assistant__msg assistant__msg--${m.from}`}>
                  <p>{m.text}</p>
                  {m.actions && m.actions.length > 0 && (
                    <div className="assistant__actions">
                      {m.actions.map((a, k) => (
                        <button key={k} type="button" className={`btn btn--sm ${a.type === 'call' ? 'btn--danger' : k === 0 ? 'btn--primary' : 'btn--secondary'}`} onClick={() => act(a)}>
                          <span className="btn__label">
                            {a.type === 'call' && <Phone />}
                            {a.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {m.suggestions && m.suggestions.length > 0 && i === msgs.length - 1 && (
                    <div className="assistant__chips">
                      {m.suggestions.map((s) => (
                        <button key={s} type="button" className="chip chip--sm" onClick={() => send(s)}>
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                  {m.intent && m.intent !== 'unknown' && (
                    <span className="assistant__meta">
                      <Sparkles /> {m.intent.replace('_', ' ')} · {Math.round((m.confidence ?? 0) * 100)}%
                    </span>
                  )}
                </div>
              ))}
              {busy && (
                <div className="assistant__msg assistant__msg--bot assistant__typing" aria-label="Assistant is typing">
                  <i />
                  <i />
                  <i />
                </div>
              )}
            </div>
            <form
              className="assistant__form"
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                void send(text)
              }}
            >
              <input ref={input} value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="Ask anything… e.g. ride to Dadar 6 pm" aria-label="Message the assistant" />
              <button type="submit" className="icon-btn assistant__send" aria-label="Send" disabled={!text.trim() || busy}>
                <Send />
              </button>
            </form>
          </motion.section>
        )}
      </AnimatePresence>
      {!open && (
        <button type="button" className="assistant-fab" aria-label="Open RideSync Assistant" onClick={() => setOpen(true)}>
          <Bot />
        </button>
      )}
    </>
  )
}
