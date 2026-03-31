import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { init } from '@neutralinojs/lib'
import { setNeutralinoActive } from '@/services/platform'
import { TooltipProvider } from '@/components/ui/tooltip'
import './index.css'
import '@/store/console'
import App from './App'

async function bootstrap() {
  if (window.NL_PORT) {
    await init()
    setNeutralinoActive(true)
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </StrictMode>,
  )
}

bootstrap()
