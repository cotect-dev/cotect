import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initPlatform } from '@/services/platform'
import { TooltipProvider } from '@/components/ui/tooltip'
import ErrorBoundary from '@/components/ErrorBoundary'
import './index.css'
import '@/store/console'
import App from './App'

// Warm the lazy chunks during main-bundle parse. Fire-and-forget dynamic
// imports trigger vite's modulepreload machinery; the chunks download in
// parallel with platform init and React hydration, so panel Suspense
// boundaries (Chat, Settings, CodeNode, …) resolve without a visible flash
// on first paint. A failure here is harmless — Suspense will re-fetch
// on demand when the panel actually mounts.
function preloadChunk(mod: Promise<unknown>, name: string): void {
  mod.catch((err: unknown) => {
    console.warn(`[preload] ${name} failed, will retry on demand:`, err)
  })
}

// Panels visible in the default layout — highest priority.
preloadChunk(import('@/components/Chat'), 'Chat')
preloadChunk(import('@/components/Changes'), 'Changes')
preloadChunk(import('@/components/Console'), 'Console')
// Panels the user can open from the top bar — still warm early.
preloadChunk(import('@/components/Settings'), 'Settings')
preloadChunk(import('@/components/History'), 'History')
preloadChunk(import('@/components/Branches'), 'Branches')
preloadChunk(import('@/components/Tasks'), 'Tasks')
// CodeNode ships CodeMirror; drilling into the first file otherwise blanks.
preloadChunk(import('@/components/Canvas/nodes/CodeNode'), 'CodeNode')
// ChatMessage's own module-level dynamic imports — pull them in parallel
// with the Chat chunk itself to avoid a two-level waterfall.
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
