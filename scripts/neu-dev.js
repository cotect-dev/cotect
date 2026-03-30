import { readFileSync, writeFileSync, watchFile, unwatchFile, existsSync } from 'fs'
import { spawn, execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = join(root, 'neutralino.config.json')
const authPath = join(root, '.tmp/auth_info.json')
const globalsOutPath = join(root, 'dist/__neutralino_globals_dev.js')

const PLATFORM_MAP = {
  linux:  { os: 'Linux',   binaries: { arm64: 'neutralino-linux_arm64', arm: 'neutralino-linux_armhf', x64: 'neutralino-linux_x64' } },
  darwin: { os: 'Darwin',  binaries: { arm64: 'neutralino-mac_arm64',   x64: 'neutralino-mac_x64',    fallback: 'neutralino-mac_universal' } },
  win32:  { os: 'Windows', binaries: { x64: 'neutralino-win_x64.exe' } },
}

function getPlatformInfo() {
  const entry = PLATFORM_MAP[process.platform] ?? PLATFORM_MAP.linux
  const binaryName = entry.binaries[process.arch] ?? entry.binaries.fallback ?? entry.binaries.x64
  const binaryPath = join(root, 'bin', binaryName)
  if (!existsSync(binaryPath)) {
    console.warn(`[neu-dev] Warning: binary not found at ${binaryPath}`)
  }
  return { os: entry.os, binaryPath }
}

const { os: neutralinoOS, binaryPath } = getPlatformInfo()

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
delete config.modes.window.hidden

writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')

const restore = () => {
  try { writeFileSync(configPath, original) } catch {}
}

function killChildWindows() {
  // Kill any Neutralino child window processes (spawned via window.create with ?window= in URL)
  try { execSync('pkill -f "neutralino.*window="', { stdio: 'ignore' }) } catch {}
}

const cleanup = () => { killChildWindows(); restore(); process.exit() }
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

// Generate a JS file that sets the NL_* globals from auth_info.json
function writeDevGlobals() {
  try {
    const auth = JSON.parse(readFileSync(authPath, 'utf-8'))
    const rootEscaped = root.replace(/\\/g, '\\\\')
    const content = `// Auto-generated for dev mode
// Guard: skip if globals were already injected by the Neutralino binary (e.g. child windows)
if (!window.NL_GINJECTED) {
  window.NL_PORT = ${auth.nlPort};
  window.NL_TOKEN = "${auth.nlToken}";
  window.NL_ARGS = [${JSON.stringify(binaryPath)}, "--load-dir-res", "--path=${rootEscaped}", "--url=http://localhost:5173"];
  window.NL_CWD = "${rootEscaped}";
  window.NL_APPID = "${config.applicationId}";
  window.NL_APPVERSION = "${config.version}";
  window.NL_EXTENABLED = false;
  window.NL_OS = "${neutralinoOS}";
  window.NL_RESMODE = "directory";
  window.NL_GINJECTED = true;
  window.NL_CMETHODS = [];
}
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
  killChildWindows()
  restore()
  process.exit(code ?? 0)
})
