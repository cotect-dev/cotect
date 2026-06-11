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

// CodeNode first: it is by far the largest chunk (CodeMirror + languages) and
// sits behind every file open — without warming, the first click on a file
// stalls blank on a Suspense fallback while ~1.3MB fetches and evaluates.
preloadChunk(import('@/components/Canvas/nodes/CodeNode'), 'CodeNode')
preloadChunk(import('@/components/Changes'), 'Changes')
if (DEV) preloadChunk(import('@/components/Console'), 'Console')
preloadChunk(import('@/components/Settings'), 'Settings')
preloadChunk(import('@/components/History'), 'History')

async function bootstrap() {
  await initPlatform()

  // Update check only in the packaged desktop app: dev builds and the
  // browser/landing bundles have no updater plugin behind the IPC. Dynamic
  // import keeps the plugin code out of non-Tauri chunks.
  if (!DEV && '__TAURI_INTERNALS__' in window) {
    void import('@/services/updater').then(({ checkForUpdates }) => checkForUpdates())
  }

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
