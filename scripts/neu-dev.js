import { readFileSync, writeFileSync, watchFile, unwatchFile, existsSync } from 'fs'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = join(root, 'neutralino.config.json')
const authPath = join(root, '.tmp/auth_info.json')
const globalsOutPath = join(root, 'dist/__neutralino_globals_dev.js')

const original = readFileSync(configPath, 'utf-8')
const config = JSON.parse(original)

// Point Neutralino at the Vite dev server for HMR
config.documentRoot = '/'
config.url = 'http://localhost:5173'

// Enforce minimum window size
config.modes.window.width = Math.max(config.modes.window.width, 1280)
config.modes.window.height = Math.max(config.modes.window.height, 720)
config.modes.window.minWidth = 1280
config.modes.window.minHeight = 720

writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')

const restore = () => {
  try { writeFileSync(configPath, original) } catch {}
}

process.on('SIGINT', () => { restore(); process.exit() })
process.on('SIGTERM', () => { restore(); process.exit() })

// Generate a JS file that sets the NL_* globals from auth_info.json
function writeDevGlobals() {
  try {
    const auth = JSON.parse(readFileSync(authPath, 'utf-8'))
    const content = `// Auto-generated for dev mode
window.NL_PORT = ${auth.nlPort};
window.NL_TOKEN = "${auth.nlToken}";
window.NL_ARGS = ["cotect", "--url=http://localhost:5173"];
window.NL_CWD = "${root.replace(/\\/g, '\\\\')}";
window.NL_APPID = "${config.applicationId}";
window.NL_APPVERSION = "${config.version}";
window.NL_EXTENABLED = false;
window.NL_OS = "${process.platform === 'darwin' ? 'Darwin' : process.platform === 'win32' ? 'Windows' : 'Linux'}";
window.NL_RESMODE = "directory";
window.NL_GINJECTED = true;
window.NL_CMETHODS = [];
`
    writeFileSync(globalsOutPath, content)
    console.log(`[neu-dev] Wrote dev globals (port: ${auth.nlPort})`)
    return true
  } catch {
    return false
  }
}

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

await waitForVite()

// Watch for auth_info.json changes and generate globals
if (existsSync(authPath)) writeDevGlobals()
watchFile(authPath, { interval: 200 }, () => writeDevGlobals())

// Run neu as a child process
const neu = spawn('npx', ['neu', 'run', '--disable-auto-reload'], {
  stdio: 'inherit',
  cwd: root,
  shell: true,
})

// Wait briefly for auth_info to be written by neu, then try again
setTimeout(() => writeDevGlobals(), 1000)
setTimeout(() => writeDevGlobals(), 2000)

neu.on('close', (code) => {
  unwatchFile(authPath)
  restore()
  process.exit(code ?? 0)
})
