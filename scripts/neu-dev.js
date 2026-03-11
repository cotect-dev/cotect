import { readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = join(root, 'neutralino.config.json')

const original = readFileSync(configPath, 'utf-8')
const config = JSON.parse(original)

// Point Neutralino at the Vite dev server for HMR
config.documentRoot = '/'
config.url = 'http://localhost:5173'

writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')

const restore = () => {
  try { writeFileSync(configPath, original) } catch {}
}

process.on('SIGINT', () => { restore(); process.exit() })
process.on('SIGTERM', () => { restore(); process.exit() })

// Wait for Vite dev server to be ready
const waitForVite = async () => {
  for (let i = 0; i < 30; i++) {
    try {
      await fetch('http://localhost:5173')
      return
    } catch {
      await new Promise(r => setTimeout(r, 500))
    }
  }
  throw new Error('Vite dev server did not start in time')
}

try {
  await waitForVite()
  execSync('npx neu run --disable-auto-reload', { stdio: 'inherit', cwd: root })
} finally {
  restore()
}
