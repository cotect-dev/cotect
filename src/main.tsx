import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initPlatform } from '@/services/platform'
import { TooltipProvider } from '@/components/ui/tooltip'
import ErrorBoundary from '@/components/ErrorBoundary'
import './index.css'
import '@/store/console'
import App from './App'

async function bootstrap() {
  await initPlatform()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ErrorBoundary>
    </StrictMode>,
  )
}

bootstrap()
