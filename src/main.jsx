import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'

// Register the PWA service worker. `immediate: true` activates a fresh worker
// as soon as it's installed (autoUpdate), and the call is a no-op in dev
// (devOptions.enabled is false).
registerSW({ immediate: true })

// Apply the saved theme before first paint to avoid a flash of the wrong theme.
// ThemeContext takes over once React mounts and keeps things in sync from there.
let savedTheme = null
try {
  savedTheme = localStorage.getItem('theme')
} catch {
  // storage unavailable; fall back to the system preference below
}

const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
const isDark = savedTheme === 'dark' || (savedTheme !== 'light' && prefersDark)
document.documentElement.classList.toggle('dark', isDark)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)