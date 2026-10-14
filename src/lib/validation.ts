/** Only students with a college email can join. The server enforces this; the UI mirrors it. */
export const DEFAULT_EMAIL_DOMAIN = 'vit.edu.in'

export function isCollegeEmail(raw: string, domain = DEFAULT_EMAIL_DOMAIN) {
  const email = raw.trim().toLowerCase()
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+$/.test(email) && email.endsWith(`@${domain.toLowerCase()}`)
}

export function validateCollegeEmail(raw: string, domain = DEFAULT_EMAIL_DOMAIN): string | null {
  const email = raw.trim().toLowerCase()
  if (!email) return 'Enter your college email'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address'
  if (!isCollegeEmail(email, domain)) return `Only @${domain} college emails can join RideSync`
  return null
}

/** College roll / student ID. Formats differ by batch, so accept 4–15 letters, digits, / or -. */
export function validateStudentId(raw: string): string | null {
  const id = raw.trim().toUpperCase()
  if (!id) return 'Enter your student ID'
  if (!/^[A-Z0-9/-]{4,15}$/.test(id)) return 'Use the ID printed on your college ID card (letters and numbers only)'
  return null
}

export function validatePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')
  if (!digits) return 'Enter your mobile number'
  if (!/^[6-9]\d{9}$/.test(digits)) return 'Enter a valid 10-digit Indian mobile number'
  return null
}

export function validatePassword(pw: string): string | null {
  if (!pw) return 'Create a password'
  if (pw.length < 8) return 'Use at least 8 characters'
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Include at least one letter and one number'
  return null
}

export function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  let s = 0
  if (pw.length >= 8) s++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw)) s++
  if (pw.length >= 12 || /[^A-Za-z0-9]/.test(pw)) s++
  return s as 0 | 1 | 2 | 3
}

export function validateName(raw: string): string | null {
  const n = raw.trim()
  if (!n) return 'Enter your full name'
  if (n.length < 3 || !/\s/.test(n)) return 'Enter your first and last name'
  return null
}

export function validateUpiId(raw: string): string | null {
  if (!raw.trim()) return 'Enter your UPI ID'
  if (!/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(raw.trim())) return 'UPI IDs look like name@bank'
  return null
}

export function luhn(num: string): boolean {
  const d = num.replace(/\D/g, '')
  if (d.length < 13 || d.length > 19) return false
  let sum = 0
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i])
    if (i % 2 === 1) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
  }
  return sum % 10 === 0
}

export function validatePlate(raw: string): string | null {
  const p = raw.replace(/\s+/g, '').toUpperCase()
  if (!p) return 'Enter your registration number'
  if (!/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/.test(p) && !/^\d{2}BH\d{4}[A-Z]{1,2}$/.test(p)) return 'Use the format MH 01 AB 1234'
  return null
}

export function formatPlate(raw: string) {
  const p = raw.replace(/\s+/g, '').toUpperCase()
  const m = p.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/)
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : raw.toUpperCase()
}

/** Most rider seats a car can offer or a rider can book: a 7-seater (Innova, Ertiga) is the driver + 6. */
export const MAX_SEATS = 6
