import { Link } from 'react-router-dom'
import { Download, Smartphone, Share } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { useQuery } from '@/services/api'

type ApkInfo = { ready: boolean; commit: string | null; publishedAt: string | null; files: { name: string; size: number }[] }

const mb = (b: number) => `${Math.round(b / 1_048_576)} MB`
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/**
 * Public download page (no sign-in): the Android app served by RideSync itself (server/apk.ts),
 * and how to add the website to an iPhone's Home Screen. Share ridesync-vit.duckdns.org/download.
 */
export function DownloadApp() {
  const q = useQuery<ApkInfo>('/app/download')
  const small = q.data?.files.find((f) => f.name === 'RideSync-small.apk')
  const full = q.data?.files.find((f) => f.name === 'RideSync.apk')
  const updated = q.data?.publishedAt ? new Date(q.data.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null
  const ios = isIos()

  return (
    <div className="legal">
      <header className="legal__top">
        <Link to="/" className="link-btn">
          Open the website
        </Link>
        <Logo />
      </header>
      <main className="legal__main download">
        <h1 className="t-h1">Get RideSync</h1>
        <p>Carpooling for VIT students: share rides to college, split the real fuel cost and see your CO₂ savings.</p>

        {!ios && (
          <section className="download__card">
            <h2>
              <Smartphone size={20} aria-hidden /> Android
            </h2>
            {q.data?.ready ? (
              <>
                <a className="btn btn--primary btn--lg btn--block" href={`/download/${(small ?? full)!.name}`} download>
                  <Download aria-hidden /> Download the app{small || full ? ` (${mb((small ?? full)!.size)})` : ''}
                </a>
                {small && full && (
                  <p className="t-sm t-muted">
                    If your phone says the app isn’t compatible, <a href={`/download/${full.name}`}>download this version</a> ({mb(full.size)}) instead.
                  </p>
                )}
                <ol>
                  <li>Open the downloaded file.</li>
                  <li>If asked, allow installing apps from your browser (“Install unknown apps”).</li>
                  <li>Tap Install — or Update if you already have RideSync. Your login and rides stay.</li>
                </ol>
                {updated && (
                  <p className="t-caption t-muted">
                    Latest version · {updated}
                    {q.data.commit ? ` · ${q.data.commit}` : ''}
                  </p>
                )}
              </>
            ) : q.loading ? (
              <p className="t-muted">Checking for the latest app…</p>
            ) : (
              <p className="t-muted">The app download is being prepared. Please try again in a few minutes, or use the website for now.</p>
            )}
          </section>
        )}

        <section className="download__card">
          <h2>
            <Share size={20} aria-hidden /> iPhone
          </h2>
          <p>RideSync works as an app on iPhone straight from the website — no App Store needed.</p>
          <ol>
            <li>
              Open <b>{location.host}</b> in <b>Safari</b>.
            </li>
            <li>Tap the Share button, then “Add to Home Screen”.</li>
            <li>Open RideSync from your Home Screen and sign in with your college email.</li>
          </ol>
        </section>

        <p className="legal__switch t-sm t-muted">
          <Link to="/privacy">Privacy Policy</Link> · <Link to="/terms">Terms of Use</Link> · <Link to="/delete-account">Delete your account</Link>
        </p>
      </main>
    </div>
  )
}
