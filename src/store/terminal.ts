import { createSyncedStore } from './synced'
import { os, events } from '@neutralinojs/lib'
import type { Terminal } from '@xterm/xterm'

interface TerminalState {
  cwd: string
  running: boolean
  activeProcessId: number | null
  history: string[]
  historyIndex: number
  xterm: Terminal | null
  setCwd: (cwd: string) => void
  setRunning: (running: boolean) => void
  setActiveProcessId: (id: number | null) => void
  pushHistory: (cmd: string) => void
  setHistoryIndex: (index: number) => void
  setXterm: (xterm: Terminal | null) => void
}

export const useTerminalStore = createSyncedStore<TerminalState>('terminal', (set) => ({
  cwd: '~',
  running: false,
  activeProcessId: null,
  history: [],
  historyIndex: -1,
  xterm: null,
  setCwd: (cwd) => set({ cwd }),
  setRunning: (running) => set({ running }),
  setActiveProcessId: (activeProcessId) => set({ activeProcessId }),
  pushHistory: (cmd) =>
    set((state) => ({
      history: [...state.history, cmd],
      historyIndex: -1,
    })),
  setHistoryIndex: (historyIndex) => set({ historyIndex }),
  setXterm: (xterm) => set({ xterm }),
}))

export async function killActiveProcess() {
  const store = useTerminalStore.getState()
  if (store.activeProcessId !== null) {
    try {
      await os.updateSpawnedProcess(store.activeProcessId, 'exit')
    } catch {
      // process may have already exited
    }
    store.setActiveProcessId(null)
    store.setRunning(false)
    store.xterm?.writeln('^C')
  }
}

export async function runCommand(input: string) {
  const store = useTerminalStore.getState()
  const term = store.xterm
  const trimmed = input.trim()
  if (!trimmed) return

  store.pushHistory(trimmed)

  if (trimmed === 'clear') {
    term?.clear()
    return
  }

  if (!window.NL_PORT) {
    term?.writeln('\x1b[31mTerminal unavailable: not running in Neutralino\x1b[0m')
    return
  }

  store.setRunning(true)

  const cdMatch = trimmed.match(/^cd\s+(.+)$/)

  if (cdMatch) {
    try {
      const result = await os.execCommand(`cd ${cdMatch[1]} && pwd`, { cwd: store.cwd })
      if (result.exitCode === 0) {
        store.setCwd(result.stdOut.trim())
      } else {
        term?.writeln(`\x1b[31m${result.stdErr.trim() || `cd: no such directory: ${cdMatch[1]}`}\x1b[0m`)
      }
    } catch (err) {
      term?.writeln(`\x1b[31m${err}\x1b[0m`)
    } finally {
      store.setRunning(false)
    }
    return
  }

  try {
    const proc = await os.spawnProcess(`cd ${store.cwd} && ${trimmed}`)
    store.setActiveProcessId(proc.id)

    await new Promise<void>((resolve) => {
      const handler = (evt: CustomEvent) => {
        const data = evt.detail
        if (data.id !== proc.id) return

        if (data.action === 'stdOut' && data.data) {
          term?.write(data.data.replace(/\n/g, '\r\n'))
        } else if (data.action === 'stdErr' && data.data) {
          term?.write(data.data.replace(/\n/g, '\r\n'))
        } else if (data.action === 'exit') {
          events.off('spawnedProcess', handler)
          resolve()
        }
      }
      events.on('spawnedProcess', handler)
    })
  } catch (err) {
    term?.writeln(`\x1b[31m${err}\x1b[0m`)
  } finally {
    store.setActiveProcessId(null)
    store.setRunning(false)
  }
}

// Resolve initial cwd once Neutralino is ready
function resolveInitialCwd() {
  os.execCommand('pwd')
    .then((r) => useTerminalStore.getState().setCwd(r.stdOut.trim()))
    .catch(() => {})
}

if (window.NL_PORT) {
  events.on('ready', resolveInitialCwd)
  resolveInitialCwd()
}
