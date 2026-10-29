import '@fontsource-variable/inter'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/layouts.css'
import './styles/screens.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Installable app (iPhone: Share → Add to Home Screen; Android/desktop: Install). Production builds only.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
