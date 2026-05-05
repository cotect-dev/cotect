import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initPlatform } from '@/services/platform'
import { TooltipProvider } from '@/components/ui/tooltip'
import ErrorBoundary from '@/components/ErrorBoundary'
import { DEV } from '@/lib/env'
import './index.css'
import '@/store/console'
import App from './App'

// Warm lazy chunks during main-bundle parse so panel Suspense boundaries
// resolve without a visible flash. Failures are harmless — Suspense
// re-fetches on demand when the panel actually mounts.
function preloadChunk(mod: Promise<unknown>, name: string): void {
  mod.catch((err: unknown) => {
    console.warn(`[preload] ${name} failed, will retry on demand:`, err)
  })
}

preloadChunk(import('@/components/Chat'), 'Chat')
preloadChunk(import('@/components/Changes'), 'Changes')
if (DEV) preloadChunk(import('@/components/Console'), 'Console')
preloadChunk(import('@/components/Settings'), 'Settings')
preloadChunk(import('@/components/History'), 'History')
preloadChunk(import('@/components/Tasks'), 'Tasks')
// ChatMessage's own dynamic imports — warm alongside Chat to avoid a
// two-level waterfall on the first message render.
preloadChunk(import('remark-gfm'), 'remark-gfm')
preloadChunk(import('react-syntax-highlighter/dist/esm/prism-async-light'), 'prism-async-light')
preloadChunk(import('react-syntax-highlighter/dist/esm/styles/prism/one-dark'), 'one-dark')

async function bootstrap() {
  await initPlatform()

  const root = document.getElementById('root')
  if (!root) throw new Error('Root element #root not found')

  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ErrorBoundary>
    </StrictMode>,
  )
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap application:', err)
})
