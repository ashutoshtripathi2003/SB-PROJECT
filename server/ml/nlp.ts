/**
 * RideSync Assistant — natural-language understanding, built from scratch (no paid AI service):
 *   • tokeniser with Hinglish normalisation ("kal" → tomorrow, "jaana hai" → go …)
 *   • TF-IDF features + Multinomial Naive Bayes intent classifier, trained on example sentences
 *   • rule-based entity extraction for places, date, time and seats
 *   • k-fold cross-validated accuracy, shown in Admin → AI
 */

export type Intent =
  | 'find_ride'
  | 'offer_ride'
  | 'next_trip'
  | 'driver_status'
  | 'cancel'
  | 'verify'
  | 'pin'
  | 'pricing'
  | 'refund'
  | 'wallet'
  | 'women_only'
  | 'safety'
  | 'share_trip'
  | 'greeting'
  | 'thanks'
  | 'help'

/** Training sentences per intent (English + Hinglish). */
export const EXAMPLES: Record<Intent, string[]> = {
  find_ride: [
    'searching for a ride to dadar', 'anyone driving to college at 9', 'i want a ride to thane', 'ride for tomorrow 8 am', 'need ride', 'find ride', 'carpool to kurla tomorrow', 'pick me up from andheri', 'going to vit any car', 'lift chahiye',
    'find me a ride to andheri', 'i need a ride to college tomorrow', 'any ride from dadar at 8 am', 'book a seat to kurla', 'looking for a carpool to vit',
    'search rides to thane tomorrow morning', 'kal subah andheri jaana hai', 'mujhe college jaana hai', 'koi ride hai bandra ke liye', 'get me a lift to sion',
    'ride from campus to ghatkopar at 6 pm', 'need to go to chembur today evening', 'show rides going to powai', 'is anyone going to vashi', 'can i get a ride home',
    'how do i reach dadar station from college', 'ride chahiye kurla tak', 'aaj shaam thane jana hai', 'find a pool to matunga', 'need 2 seats to borivali',
  ],
  offer_ride: [
    'i will drive tomorrow', 'offer ride', 'i am going by car to bandra anyone', 'list my car ride', 'giving a ride to dadar', 'i have 2 empty seats', 'taking my car to college', 'seats available in my car', 'become a driver', 'main drive karunga',
    'i want to offer a ride', 'i am driving to dadar at 5 pm', 'offer a ride with 3 seats', 'publish my ride to andheri', 'i have a car going to college tomorrow',
    'share my car to thane', 'post a ride from campus at 6', 'main gaadi le ja raha hoon andheri', 'meri car mein jagah hai', 'i can take riders to kurla',
    'create a ride offer', 'driving home after class anyone can join', 'add my ride for tomorrow morning', 'want to carpool my car', 'offer seats in my car',
  ],
  next_trip: [
    'next ride', 'my upcoming ride', 'booked rides', 'show bookings', 'ride kab hai', 'do i have any trip', 'my next trip time', 'what time is my ride',
    'when is my next ride', 'show my upcoming trips', 'what rides have i booked', 'my bookings', 'do i have a ride today',
    'meri next ride kab hai', 'my trips', 'what is my ride tomorrow', 'show my schedule', 'which ride did i book', 'upcoming ride details', 'list my rides',
  ],
  driver_status: [
    'driver location', 'car kahan hai', 'how many minutes for driver', 'is the driver near', 'driver late', 'track driver', 'driver arriving when',
    'where is my driver', 'is my driver coming', 'how far is the car', 'when will the driver arrive', 'driver kahan hai',
    'track my ride', 'how long until pickup', 'eta of my driver', 'has the driver started', 'where is the car now', 'driver aa raha hai kya',
  ],
  cancel: [
    'cancel ride', 'cancel booking please', 'i want to withdraw', 'dont need the ride anymore', 'cancel karo', 'remove me from the ride', 'stop my booking',
    'cancel my booking', 'i want to cancel my ride', 'how do i cancel', 'cancel my seat', 'remove my booking', 'ride cancel karna hai',
    'i cant come cancel it', 'withdraw my request', 'cancel the trip', 'how to cancel an offered ride',
  ],
  verify: [
    'verification', 'get verified', 'blue tick kaise', 'student id check', 'upload id', 'verified student badge', 'id card verify',
    'how do i get verified', 'what is the blue tick', 'upload my id card', 'how to get the verified badge', 'id verification',
    'verify my student id', 'why am i not verified', 'verified badge kaise milega', 'id card upload', 'my id was rejected',
  ],
  pin: [
    'ride pin', 'start pin', 'pin number', '4 digit pin', 'otp for ride', 'where do i find the code', 'code for driver',
    'what is the ride pin', 'where is my pin', 'driver is asking for pin', 'what is the 4 digit code', 'pin kya hai',
    'how does the start code work', 'wrong pin', 'i forgot my pin', 'why do i need a pin', 'ride pin kahan milega',
  ],
  pricing: [
    'price', 'fare', 'cost', 'how much money', 'ride charges', 'why so costly', 'price per seat', 'kitne paise',
    'how are prices calculated', 'why is the fare this much', 'how much does a ride cost', 'price kaise decide hota hai', 'fare calculation',
    'how much should i charge', 'is it expensive', 'cost of ride to andheri', 'what decides the price', 'kitna paisa lagega',
  ],
  refund: [
    'refund', 'money back', 'get refund', 'refund not received', 'cancelled ride money', 'return my money', 'refund policy',
    'how do refunds work', 'will i get my money back', 'refund my payment', 'driver cancelled where is my money', 'paisa wapas kab milega',
    'refund status', 'money not returned', 'i paid but ride cancelled', 'refund kaise milega', 'how long does refund take',
  ],
  wallet: [
    'wallet', 'add money', 'balance', 'recharge wallet', 'upi payment', 'how to pay driver', 'pay online', 'razorpay',
    'how do i add money', 'wallet balance', 'add money to wallet', 'pay from wallet', 'how does the wallet work',
    'wallet mein paise kaise daalu', 'top up my wallet', 'what is ridesync wallet', 'payment options', 'can i pay by upi', 'how do i pay',
  ],
  women_only: [
    'women only', 'female ride', 'ladies ride', 'girls carpool', 'women drivers', 'safe for girls', 'women only option',
    'are there women only rides', 'female only ride', 'ladies only carpool', 'how to offer a women only ride', 'girls only ride',
    'women only rides kaise milenge', 'safe ride for women', 'only female drivers', 'ladies ke liye ride',
  ],
  safety: [
    'emergency', 'call 112', 'unsafe', 'danger', 'help sos', 'harassment', 'driver misbehaving', 'accident',
    'i feel unsafe', 'help me emergency', 'sos', 'the driver is behaving badly', 'call police', 'i am in danger',
    'driver went wrong way', 'mujhe dar lag raha hai', 'emergency help', 'report the driver', 'something is wrong', 'unsafe ride',
  ],
  share_trip: [
    'share trip', 'share location', 'send location to parents', 'whatsapp trip link', 'family tracking', 'share my ride', 'live location share',
    'share my trip with my parents', 'send my location to mom', 'share live location', 'how can my family track me', 'share ride on whatsapp',
    'ghar walon ko location bhejo', 'track link for parents', 'send trip link to friend',
  ],
  greeting: [
    'hey there', 'hi ridesync', 'hello bot', 'namaskar', 'good afternoon', 'sup', 'heyy','hi', 'hello', 'hey', 'good morning', 'namaste', 'hii there', 'yo', 'hello ridesync', 'good evening', 'kaise ho'],
  thanks: [
    'thanks a lot', 'thank u', 'ty', 'nice thanks', 'cool thanks', 'great help', 'bahut accha','thanks', 'thank you', 'thx', 'great thanks', 'shukriya', 'dhanyavad', 'awesome thank you', 'ok thanks', 'perfect'],
  help: [
    'what are your features', 'how does this work', 'help me', 'what can i ask', 'commands', 'assist me', 'menu',
    'what can you do', 'help', 'how does ridesync work', 'what is this app', 'how to use', 'guide me', 'kya kar sakte ho', 'features', 'how do i start', 'explain the app',
  ],
}

/* ---- Text processing --------------------------------------------------- */

const HINGLISH: Record<string, string> = {
  kal: 'tomorrow', parso: 'dayafter', aaj: 'today', subah: 'morning', shaam: 'evening', sham: 'evening', raat: 'night', dopahar: 'afternoon',
  jaana: 'go', jana: 'go', jaa: 'go', chahiye: 'need', mujhe: 'i', meri: 'my', mera: 'my', gaadi: 'car', gadi: 'car', paisa: 'money', paise: 'money',
  wapas: 'back', kahan: 'where', kab: 'when', kaise: 'how', kya: 'what', ladies: 'women', ladki: 'women', girls: 'women', female: 'women',
}
const STOP = new Set(['a', 'an', 'the', 'is', 'am', 'are', 'to', 'for', 'of', 'me', 'please', 'pls', 'hai', 'ho', 'ka', 'ki', 'ke', 'se', 'tak', 'liye', 'do', 'it', 'at', 'in', 'on', 'and', 'can', 'you'])

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => HINGLISH[t] ?? t)
    .map((t) => t.replace(/(ing|ed|es|s)$/, (m) => (t.length > 4 ? '' : m)))
    .filter((t) => !STOP.has(t))
}
/** Words plus word pairs ("next ride", "cancel booking") for more context. */
const features = (text: string) => {
  const t = tokens(text)
  // Character trigrams make it robust to typos and word forms ("cancl", "booking"/"booked").
  const grams = t.flatMap((w) => {
    const x = `#${w}#`
    return x.length < 4 ? [] : Array.from({ length: x.length - 2 }, (_, i) => `~${x.slice(i, i + 3)}`)
  })
  return [...t, ...t, ...t.slice(1).map((w, i) => `${t[i]}_${w}`), ...grams]
}

/* ---- TF-IDF + Multinomial Naive Bayes ---------------------------------- */

export type NB = { classes: Intent[]; prior: Record<string, number>; logp: Record<string, Record<string, number>>; unk: Record<string, number>; idf: Record<string, number> }

export function trainNB(data: { text: string; intent: Intent }[]): NB {
  const docs = data.map((d) => ({ f: features(d.text), intent: d.intent }))
  const df: Record<string, number> = {}
  for (const d of docs) for (const w of new Set(d.f)) df[w] = (df[w] ?? 0) + 1
  const idf = Object.fromEntries(Object.entries(df).map(([w, n]) => [w, Math.log((1 + docs.length) / (1 + n)) + 1]))
  const classes = [...new Set(docs.map((d) => d.intent))]
  const vocab = Object.keys(idf)
  const prior: Record<string, number> = {}
  const logp: Record<string, Record<string, number>> = {}
  const unk: Record<string, number> = {}
  for (const c of classes) {
    const cd = docs.filter((d) => d.intent === c)
    prior[c] = Math.log(cd.length / docs.length)
    const w: Record<string, number> = {}
    for (const d of cd) for (const t of d.f) w[t] = (w[t] ?? 0) + idf[t]
    const total = Object.values(w).reduce((a, v) => a + v, 0)
    const alpha = 0.5
    logp[c] = {}
    for (const t of vocab) logp[c][t] = Math.log(((w[t] ?? 0) + alpha) / (total + alpha * vocab.length))
    unk[c] = Math.log(alpha / (total + alpha * vocab.length))
  }
  return { classes, prior, logp, unk, idf }
}

export function classify(m: NB, text: string): { intent: Intent; confidence: number; known: number } {
  const f = features(text)
  // Out-of-vocabulary guard: needs at least one real word the model has seen (not just letter patterns).
  const known = tokens(text).filter((t) => m.idf[t] !== undefined).length
  const scores = m.classes.map((c) => ({ c, s: m.prior[c] + f.reduce((a, t) => a + (m.idf[t] !== undefined ? m.logp[c][t] : 0), 0) }))
  const max = Math.max(...scores.map((x) => x.s))
  const exp = scores.map((x) => ({ c: x.c, p: Math.exp(x.s - max) }))
  const sum = exp.reduce((a, x) => a + x.p, 0)
  const best = exp.sort((a, b) => b.p - a.p)[0]
  return { intent: best.c, confidence: known ? best.p / sum : 0, known }
}

const all = () => (Object.entries(EXAMPLES) as [Intent, string[]][]).flatMap(([intent, xs]) => xs.map((text) => ({ text, intent })))

/** 5-fold cross-validation accuracy on the training sentences. */
export function crossValidate(k = 5) {
  const data = all()
  let correct = 0
  for (let fold = 0; fold < k; fold++) {
    const test = data.filter((_, i) => i % k === fold)
    const m = trainNB(data.filter((_, i) => i % k !== fold))
    correct += test.filter((d) => classify(m, d.text).intent === d.intent).length
  }
  return { accuracy: Math.round((correct / data.length) * 1000) / 1000, examples: data.length, intents: Object.keys(EXAMPLES).length }
}

export const model = trainNB(all())

/* ---- Entities: places, date, time, seats ----------------------------- */

export type KnownPlace = { id: string; name: string; area: string; lat: number; lng: number; kind: string; aliases: string[] }
export const CAMPUS: KnownPlace = { id: 'vit-campus', name: 'VIT Wadala', area: 'Wadala', lat: 19.0222, lng: 72.8711, kind: 'campus', aliases: ['college', 'campus', 'vit', 'vidyalankar', 'wadala', 'clg'] }
export const PLACES: KnownPlace[] = [
  CAMPUS,
  ...([
    ['Andheri Station', 'Andheri', 19.1197, 72.8468, ['andheri']],
    ['Dadar Station', 'Dadar', 19.0178, 72.8478, ['dadar']],
    ['Kurla Station', 'Kurla', 19.0656, 72.8792, ['kurla']],
    ['Chembur Station', 'Chembur', 19.0622, 72.9005, ['chembur']],
    ['Sion Circle', 'Sion', 19.0433, 72.8634, ['sion']],
    ['Ghatkopar Station', 'Ghatkopar', 19.0863, 72.9081, ['ghatkopar']],
    ['Thane Station', 'Thane', 19.1865, 72.9757, ['thane']],
    ['Bandra Station', 'Bandra', 19.0544, 72.8406, ['bandra', 'bkc']],
    ['Powai Hiranandani', 'Powai', 19.1176, 72.906, ['powai', 'hiranandani']],
    ['Vashi Station', 'Vashi', 19.0771, 72.9988, ['vashi', 'navi mumbai']],
    ['Matunga Station', 'Matunga', 19.0273, 72.8553, ['matunga']],
    ['Borivali Station', 'Borivali', 19.2307, 72.8567, ['borivali']],
    ['Malad Station', 'Malad', 19.1868, 72.8484, ['malad']],
    ['Goregaon Station', 'Goregaon', 19.1647, 72.8493, ['goregaon']],
    ['Mulund Station', 'Mulund', 19.1726, 72.9565, ['mulund']],
    ['CSMT', 'Fort', 18.9402, 72.8356, ['csmt', 'vt', 'cst', 'fort']],
    ['Churchgate', 'Churchgate', 18.9322, 72.8264, ['churchgate']],
    ['Worli', 'Worli', 19.0176, 72.8176, ['worli']],
    ['Parel', 'Parel', 19.0096, 72.8376, ['parel', 'lower parel']],
    ['Vikhroli', 'Vikhroli', 19.1113, 72.928, ['vikhroli']],
  ] as [string, string, number, number, string[]][]).map(([name, area, lat, lng, aliases]) => ({ id: `place-${area.toLowerCase().replace(/\s+/g, '-')}`, name, area, lat, lng, kind: 'station', aliases })),
]

const IST = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000)
const ymd = (d: Date) => IST(d).toISOString().slice(0, 10)

export type Entities = { from?: KnownPlace; to?: KnownPlace; date?: string; time?: string; seats?: number; unknownPlace?: string }

export function entities(text: string, now = new Date()): Entities {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9:\s]/g, ' ').replace(/\s+/g, ' ')} `
  const out: Entities = {}
  // Places, with their position so we can tell "from X to Y".
  const found: { p: KnownPlace; at: number }[] = []
  for (const p of PLACES) for (const a of p.aliases) {
    const i = t.indexOf(` ${a} `)
    if (i >= 0 && !found.some((f) => f.p.id === p.id)) found.push({ p, at: i })
  }
  found.sort((a, b) => a.at - b.at)
  const before = (at: number, words: string[]) => words.some((w) => t.slice(Math.max(0, at - 8), at).includes(` ${w} `) || t.slice(Math.max(0, at - 8), at).endsWith(` ${w}`))
  for (const f of found) {
    if (before(f.at, ['from', 'se'])) out.from = f.p
    else if (!out.to) out.to = f.p
    else if (!out.from) out.from = f.p
  }
  // "andheri se college" (Hindi order: X se Y) → from X to Y
  const se = t.match(/ ([a-z]+) se ([a-z]+) /)
  if (se) {
    const a = PLACES.find((p) => p.aliases.includes(se[1]))
    const b = PLACES.find((p) => p.aliases.includes(se[2]))
    if (a && b) Object.assign(out, { from: a, to: b })
  }
  if (!found.length) {
    const m = t.match(/ (?:to|for|till|tak) ([a-z]{3,}(?: [a-z]{3,})?) /)
    if (m && !['college', 'home', 'my', 'the'].includes(m[1])) out.unknownPlace = m[1]
  }
  // Date
  const day = 86_400_000
  if (/ (tomorrow|kal) /.test(t)) out.date = ymd(new Date(now.getTime() + day))
  else if (/ (day after|parso) /.test(t)) out.date = ymd(new Date(now.getTime() + 2 * day))
  else if (/ (today|aaj|tonight) /.test(t)) out.date = ymd(now)
  else {
    const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const i = names.findIndex((n) => t.includes(` ${n} `) || t.includes(` ${n.slice(0, 3)} `))
    if (i >= 0) {
      const today = IST(now).getUTCDay()
      out.date = ymd(new Date(now.getTime() + (((i - today + 7) % 7) || 7) * day))
    }
  }
  // Time: "8 am", "8:30 pm", "18:00", "at 6", or morning/evening words
  const tm = t.match(/ (\d{1,2})(?::(\d{2}))? ?(am|pm|baje)? /g)?.map((s) => s.trim()).find((s) => /am|pm|baje|:/.test(s) || / at /.test(t))
  if (tm) {
    const m = tm.match(/(\d{1,2})(?::(\d{2}))? ?(am|pm|baje)?/)!
    let h = Number(m[1])
    const min = Number(m[2] ?? 0)
    if (m[3] === 'pm' && h < 12) h += 12
    if (m[3] === 'am' && h === 12) h = 0
    if (!m[3] && h >= 1 && h <= 7 && / (evening|night|shaam|raat) /.test(t)) h += 12
    if (h <= 23 && min <= 59) out.time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
  }
  if (!out.time) {
    if (/ (morning|subah) /.test(t)) out.time = '08:30'
    else if (/ (afternoon|dopahar) /.test(t)) out.time = '14:00'
    else if (/ (evening|shaam) /.test(t)) out.time = '18:00'
    else if (/ (night|raat|tonight) /.test(t)) out.time = '21:00'
  }
  const seats = t.match(/ (\d) (?:seat|seats|people|log|friends) /)
  if (seats) out.seats = Math.min(6, Math.max(1, Number(seats[1])))
  return out
}
