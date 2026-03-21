import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { init } from '@neutralinojs/lib'
import { TooltipProvider } from '@/components/ui/tooltip'
import './index.css'
import '@/store/console'
import App from './App'

if (window.NL_PORT) {
  init()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
)
