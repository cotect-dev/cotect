import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './landing.css'
import './seed'
import { LandingPage } from './LandingPage'
import iconUrl from '../public/icon.svg'

// publicDir is disabled for this entry (the app's public/ carries multi-MB
// wasm parsers), so the favicon is wired through the asset pipeline instead.
const favicon = document.createElement('link')
favicon.rel = 'icon'
favicon.type = 'image/svg+xml'
favicon.href = iconUrl
document.head.appendChild(favicon)

// The hero renders immediately; store seeding (started by ./seed) resolves in
// parallel and gates only the lazy demo components.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LandingPage />
  </StrictMode>,
)
