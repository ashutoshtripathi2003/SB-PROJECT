import { Download, Share, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from './ui'

/** Chrome / Edge / Android's own install prompt, kept until the student taps "Install". */
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

const KEY = 'ridesync.installHint'
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isAndroid = () => /android/i.test(navigator.userAgent)

function dismissed() {
  try {
    return localStorage.getItem(KEY) === 'dismissed'
  } catch {
    return false
  }
}

/**
 * "Install RideSync": on iPhone, how to add it to the Home Screen (Safari has no install button); on desktop
 * browsers, the browser's own install prompt. Hidden once installed, on Android (that's the Play Store app) or
 * after the student closes it.
 */
export function InstallHint({ beforeLogin }: { beforeLogin?: boolean }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null)
  const [hidden, setHidden] = useState(() => standalone() || dismissed() || isAndroid())
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPrompt(e as InstallPrompt)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])
  if (hidden || (!isIos() && !prompt)) return null
  const close = () => {
    try {
      localStorage.setItem(KEY, 'dismissed')
    } catch {
      /* private browsing: just hide it for now */
    }
    setHidden(true)
  }
  return (
    <div className="install-hint" role="note">
      <span className="install-hint__icon">
        <img src="/apple-touch-icon.png" alt="" width={36} height={36} />
      </span>
      <div className="stack grow" style={{ minWidth: 0 }}>
        <span className="t-body t-strong">Install the RideSync app</span>
        {isIos() ? (
          <span className="t-sm t-muted">
            In Safari, tap <Share size={14} aria-label="Share" style={{ display: 'inline', verticalAlign: '-2px' }} /> then <b>Add to Home Screen</b>.
            {beforeLogin ? ' Install first, then sign in inside the app.' : ' You’ll sign in once more inside the app.'}
          </span>
        ) : (
          <span className="t-sm t-muted">Opens full screen from your home screen or desktop, like any app.</span>
        )}
      </div>
      {prompt && (
        <Button
          size="sm"
          icon={<Download />}
          onClick={async () => {
            await prompt.prompt()
            if ((await prompt.userChoice).outcome === 'accepted') setHidden(true)
            setPrompt(null)
          }}
        >
          Install
        </Button>
      )}
      <button type="button" className="icon-btn" aria-label="Close" onClick={close}>
        <X size={18} />
      </button>
    </div>
  )
}
