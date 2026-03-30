import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { init, events, window as neuWindow } from '@neutralinojs/lib'
import { setNeutralinoActive } from '@/services/platform'
import { TooltipProvider } from '@/components/ui/tooltip'
import './index.css'
import '@/store/console'
import App from './App'

if (window.NL_PORT) {
  init()
  setNeutralinoActive(true)

  // Show window after Neutralino connection is ready (window starts hidden to prevent white flash)
  events.on('ready', () => {
    neuWindow.show().catch(() => {})
  }).catch(() => {})
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
)

// Fade out splash screen
const splash = document.getElementById('splash')
if (splash) {
  splash.classList.add('hide')
  setTimeout(() => splash.remove(), 200)
}
