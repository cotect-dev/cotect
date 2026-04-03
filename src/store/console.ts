import { create } from 'zustand'
import { preserveStoreOnHMR } from '@/lib/hmr'

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export interface LogEntry {
  id: string
  level: LogLevel
  message: string
  timestamp: number
}

interface ConsoleState {
  entries: LogEntry[]
  filter: LogLevel | null
  log: (level: LogLevel, message: string) => void
  clear: () => void
  setFilter: (filter: LogLevel | null) => void
}

const MAX_ENTRIES = 1000
let nextId = 0

export const useConsoleStore = create<ConsoleState>((set) => ({
  entries: [],
  filter: null,
  log: (level, message) =>
    set((state) => {
      const entry = { id: String(nextId++), level, message, timestamp: Date.now() }
      if (state.entries.length < MAX_ENTRIES) {
        return { entries: [...state.entries, entry] }
      }
      const trimmed = state.entries.slice(-(MAX_ENTRIES - 1))
      trimmed.push(entry)
      return { entries: trimmed }
    }),
  clear: () => set({ entries: [] }),
  setFilter: (filter) => set({ filter }),
}))

const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a
      try {
        return JSON.stringify(a, null, 2) ?? String(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

console.log = (...args: unknown[]) => {
  originalConsole.log(...args)
  useConsoleStore.getState().log('info', formatArgs(args))
}

console.warn = (...args: unknown[]) => {
  originalConsole.warn(...args)
  useConsoleStore.getState().log('warn', formatArgs(args))
}

console.error = (...args: unknown[]) => {
  originalConsole.error(...args)
  useConsoleStore.getState().log('error', formatArgs(args))
}

console.debug = (...args: unknown[]) => {
  originalConsole.debug(...args)
  useConsoleStore.getState().log('debug', formatArgs(args))
}

preserveStoreOnHMR(import.meta.hot, 'console', useConsoleStore)
