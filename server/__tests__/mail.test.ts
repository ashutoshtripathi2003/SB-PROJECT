import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

process.env.DATABASE_PATH = ':memory:'
process.env.SMTP_HOST = 'smtp.gmail.com'
process.env.SMTP_USER = 'ridesync.vit@gmail.com'
process.env.SMTP_PASS = 'x'
process.env.MAIL_FROM = 'RideSync <ridesync.vit@gmail.com>'
process.env.SMTP2_HOST = 'smtp-relay.brevo.com'
process.env.SMTP2_USER = 'abc@smtp-brevo.com'
process.env.SMTP2_PASS = 'y'
process.env.MAIL2_FROM = 'RideSync <codes@example.com>'

describe('login email failover', () => {
  it('switches to the backup when Gmail hits its daily limit, and stays switched', async () => {
    const mail = await import('../mail')
    const [main, backup] = mail.__senders
    const sentBy: string[] = []
    let mainCalls = 0
    main.transport.sendMail = vi.fn(async () => {
      mainCalls++
      throw new Error('550 5.4.5 Daily user sending limit exceeded')
    }) as never
    backup.transport.sendMail = vi.fn(async (m: { from: string; to: string; subject: string }) => {
      sentBy.push(`${m.from} -> ${m.to}: ${m.subject}`)
      return {}
    }) as never
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await mail.sendLoginCode('a@vit.edu.in', '111111')
    await mail.sendLoginCode('b@vit.edu.in', '222222')
    expect(sentBy).toEqual(['RideSync <codes@example.com> -> a@vit.edu.in: 111111 is your RideSync login code', 'RideSync <codes@example.com> -> b@vit.edu.in: 222222 is your RideSync login code'])
    // Gmail was paused after the first quota error, not retried for every student.
    expect(mainCalls).toBe(1)
    expect(mail.mailStatus()[0].paused).toBe(true)

    // When every sender is exhausted, students get a clear message instead of a silent failure.
    backup.transport.sendMail = vi.fn(async () => {
      throw new Error('421 Rate limit exceeded')
    }) as never
    await expect(mail.sendLoginCode('c@vit.edu.in', '333333')).rejects.toThrow(/Sign in with Microsoft/)
  })
})

describe('showing login codes in the server log', () => {
  it('online, shows them only while the admin switch file exists', async () => {
    const { showLoginCodes } = await import('../mail')
    const dir = mkdtempSync(join(tmpdir(), 'rs-codes-'))
    const file = join(dir, 'show-login-codes')
    expect(showLoginCodes(true, file)).toBe(false)
    writeFileSync(file, '')
    expect(showLoginCodes(true, file)).toBe(true)
    rmSync(dir, { recursive: true })
    expect(showLoginCodes(true, file)).toBe(false)
  })

  it('on a laptop, shows them unless SHOW_LOGIN_CODES=false', async () => {
    const { showLoginCodes } = await import('../mail')
    expect(showLoginCodes(false, '/nowhere')).toBe(true)
    process.env.SHOW_LOGIN_CODES = 'false'
    expect(showLoginCodes(false, '/nowhere')).toBe(false)
    delete process.env.SHOW_LOGIN_CODES
  })
})
