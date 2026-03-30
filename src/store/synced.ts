import { create, type StateCreator } from 'zustand'
import { loadPanelState, savePanelState } from '@/services/panelState'

function isSerializable(value: unknown): boolean {
  if (value === null || value === undefined) return true
  const type = typeof value
  if (type === 'function') return false
  if (type !== 'object') return true
  if (Array.isArray(value)) return true
  // Exclude class instances (AbortController, Terminal, etc.)
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function getSerializableState<T>(state: T): Partial<T> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(state as Record<string, unknown>)) {
    if (isSerializable(value)) {
      result[key] = value
    }
  }
  return result as Partial<T>
}

/**
 * Drop-in replacement for Zustand's `create` that auto-syncs state to a shared file.
 * Functions and non-serializable values (class instances) are excluded automatically.
 * State loads from the shared file on creation and saves on every change (debounced).
 */
export function createSyncedStore<T>(name: string, creator: StateCreator<T>) {
  const store = create<T>(creator)

  // Load saved state
  loadPanelState<Partial<T>>(name).then((saved) => {
    if (saved && typeof saved === 'object') {
      store.setState(saved)
    }
  })

  // Auto-save on changes (debounced)
  let timer: ReturnType<typeof setTimeout> | null = null
  store.subscribe(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      savePanelState(name, getSerializableState(store.getState()))
    }, 300)
  })

  return store
}
