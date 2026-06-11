import { setDemoMode } from '@/lib/demoMode'
import { initPlatform } from '@/services/platform'

// Demo mode flips synchronously at import, before anything mounts.
setDemoMode(true)

// Seeding pulls the store stack (ReactFlow, tree-sitter helpers) through the
// demoData chunk, so it runs in parallel with the hero render; the lazy demo
// components await this before mounting.
export const seedReady: Promise<void> = (async () => {
  await initPlatform()
  const { seedDemoStores } = await import('./demoData')
  seedDemoStores()
})()
