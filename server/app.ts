import express, { type NextFunction, type Request, type Response } from 'express'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadUser } from './auth'
import { env } from './env'
import { HttpError } from './logic'
import { api, razorpayWebhook } from './routes'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()')
    next()
  })

  // Payment gateway webhook: needs the raw body for signature checks, and comes from Razorpay (no CSRF header).
  app.post('/api/payments/razorpay/webhook', express.raw({ type: '*/*', limit: '200kb' }), (req, res) => void razorpayWebhook(req, res))

  app.use('/api', express.json({ limit: '400kb' }))
  app.use('/api', loadUser)

  // CSRF: state-changing requests must come from our own JS (custom header can't be sent cross-site without CORS).
  app.use('/api', (req: Request, _res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('x-ridesync') !== '1') return next(new HttpError(403, 'Request blocked.'))
    next()
  })

  app.use('/api', api)
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')))

  // Serve the built web app (npm run build) with SPA fallback.
  const dist = resolve(process.cwd(), 'dist')
  if (existsSync(dist)) {
    app.use(
      express.static(dist, {
        index: false,
        maxAge: '1h',
        setHeaders: (res, path) => {
          if (path.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          // The service worker and manifest must update as soon as a new version is deployed.
          else if (/(sw\.js|manifest\.webmanifest)$/.test(path)) res.setHeader('Cache-Control', 'no-cache')
        },
      }),
    )
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')))
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, field: err.field })
    if ((err as { type?: string })?.type === 'entity.too.large') return res.status(413).json({ error: 'That upload is too large.' })
    console.error('[ridesync]', err)
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' })
  })
  return app
}

export { env }
