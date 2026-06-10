import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './landing.css'
import { LandingPage } from './LandingPage'
import iconUrl from '../public/icon.svg'

// publicDir is disabled for this entry (the app's public/ carries multi-MB
// wasm parsers), so the favicon is wired through the asset pipeline instead.
const favicon = document.createElement('link')
favicon.rel = 'icon'
favicon.type = 'image/svg+xml'
favicon.href = iconUrl
document.head.appendChild(favicon)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LandingPage />
  </StrictMode>,
)
