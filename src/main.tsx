import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initPlatform } from '@/services/platform'
import { TooltipProvider } from '@/components/ui/tooltip'
import './index.css'
import '@/store/console'
import App from './App'

async function bootstrap() {
  await initPlatform()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </StrictMode>,
  )
}

bootstrap()
