import { describe, expect, it } from 'vitest'

process.env.DATABASE_PATH = ':memory:'
const { classify, model, entities, crossValidate } = await import('../ml/nlp')
const { answer, assistantStats } = await import('../assistant')

describe('RideSync Assistant (NLP)', () => {
  it('classifies English and Hinglish messages', () => {
    const cases: [string, string][] = [
      ['find me a ride to andheri tomorrow at 8 am', 'find_ride'],
      ['kal subah andheri se college jaana hai', 'find_ride'],
      ['I am driving to dadar at 5 pm with 3 seats', 'offer_ride'],
      ['meri next ride kab hai', 'next_trip'],
      ['where is my driver', 'driver_status'],
      ['mujhe dar lag raha hai', 'safety'],
      ['refund kab milega', 'refund'],
      ['how are prices calculated', 'pricing'],
    ]
    for (const [text, intent] of cases) expect(classify(model, text).intent, text).toBe(intent)
    expect(crossValidate().accuracy).toBeGreaterThan(0.7)
  })

  it('extracts places, date, time and seats', () => {
    const now = new Date('2026-10-10T10:00:00Z') // Saturday
    expect(entities('andheri se college kal subah', now)).toMatchObject({ from: { area: 'Andheri' }, to: { area: 'Wadala' }, date: '2026-10-11', time: '08:30' })
    expect(entities('ride from thane to vit on monday 6 pm', now)).toMatchObject({ from: { area: 'Thane' }, to: { area: 'Wadala' }, date: '2026-10-12', time: '18:00' })
    expect(entities('driving to dadar at 5:30 pm with 3 seats', now)).toMatchObject({ to: { area: 'Dadar' }, time: '17:30', seats: 3 })
  })

  it('answers with actions and logs intents for the admin', async () => {
    const find = await answer('u1', 'Priya', 'find me a ride to andheri tomorrow at 8 am')
    expect(find.intent).toBe('find_ride')
    expect(find.actions[0]).toMatchObject({ type: 'search', query: { pickup: { name: 'VIT Wadala' }, drop: { name: 'Andheri Station' }, time: '08:00' } })
    const sos = await answer('u1', 'Priya', 'I feel unsafe')
    expect(sos.actions.some((a) => a.type === 'call' && a.tel === '112')).toBe(true)
    const none = await answer('u1', 'Priya', 'when is my next ride')
    expect(none.reply).toMatch(/no upcoming rides/)
    const junk = await answer('u1', 'Priya', 'qwzx plorp')
    expect(junk.intent).toBe('unknown')
    expect(junk.suggestions.length).toBeGreaterThan(0)
    const stats = assistantStats()
    expect(stats.messages30d).toBe(4)
    expect(stats.topIntents.length).toBeGreaterThan(0)
  })
})
