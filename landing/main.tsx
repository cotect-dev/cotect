import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './landing.css'
import './seed'
import { LandingPage } from './LandingPage'

// The hero renders immediately; store seeding (started by ./seed) resolves in
// parallel and gates only the lazy demo components.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LandingPage />
  </StrictMode>,
)
