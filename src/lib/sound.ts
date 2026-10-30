/**
 * Short, friendly sounds for the moments people wait for (like Uber and Rapido): a seat confirmed, a new ride
 * request, the driver arriving, a new message. Made with the Web Audio API, so there are no files to download,
 * plus a short vibration on phones. Students can turn sounds off in Settings.
 */

export type Sound = 'success' | 'request' | 'arrived' | 'message' | 'sent' | 'start' | 'cancel'

const KEY = 'ridesync.sounds'

export function soundsOn() {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function setSoundsOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    /* private browsing: keep the default */
  }
}

// Each sound: notes as [frequency in Hz, start in s, length in s], and a vibration pattern in ms.
const NOTES: Record<Sound, { notes: [number, number, number][]; vibrate: number[]; volume?: number }> = {
  // Rising major chord: booked, accepted, paid, completed.
  success: { notes: [[523.25, 0, 0.18], [659.25, 0.09, 0.18], [783.99, 0.18, 0.32]], vibrate: [40, 60, 40] },
  // Two-tone "ding-dong" that gets a driver's attention.
  request: { notes: [[880, 0, 0.22], [659.25, 0.22, 0.34], [880, 0.62, 0.22], [659.25, 0.84, 0.34]], vibrate: [120, 80, 120, 80, 120], volume: 0.32 },
  // Bright double beep: your driver is here.
  arrived: { notes: [[987.77, 0, 0.12], [1318.51, 0.14, 0.24]], vibrate: [200, 100, 200] },
  // Soft pop: a new message.
  message: { notes: [[1046.5, 0, 0.09], [1396.91, 0.06, 0.12]], vibrate: [30], volume: 0.18 },
  // Gentle "whoosh up": request sent, ride published.
  sent: { notes: [[587.33, 0, 0.12], [880, 0.08, 0.22]], vibrate: [30], volume: 0.2 },
  // Ride started.
  start: { notes: [[392, 0, 0.14], [523.25, 0.12, 0.14], [659.25, 0.24, 0.26]], vibrate: [60] },
  // Falling two notes: cancelled or declined (not alarming).
  cancel: { notes: [[659.25, 0, 0.18], [493.88, 0.16, 0.3]], vibrate: [80], volume: 0.2 },
}

let ctx: AudioContext | null = null
function audio() {
  if (ctx) return ctx
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  ctx = AC ? new AC() : null
  return ctx
}

// Browsers only allow sound after the person has tapped something: wake the audio on the first tap.
if (typeof window !== 'undefined') {
  const unlock = () => {
    void audio()?.resume()
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}

export function play(sound: Sound) {
  if (!soundsOn()) return
  const s = NOTES[sound]
  try {
    navigator.vibrate?.(s.vibrate)
  } catch {
    /* not supported */
  }
  const ac = audio()
  if (!ac || ac.state === 'closed') return
  void ac.resume()
  const t0 = ac.currentTime + 0.02
  const master = ac.createGain()
  master.gain.value = s.volume ?? 0.25
  master.connect(ac.destination)
  for (const [freq, start, len] of s.notes) {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    // A soft bell: quick attack, smooth fade.
    gain.gain.setValueAtTime(0, t0 + start)
    gain.gain.linearRampToValueAtTime(1, t0 + start + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + start + len)
    osc.connect(gain).connect(master)
    osc.start(t0 + start)
    osc.stop(t0 + start + len + 0.05)
  }
}
