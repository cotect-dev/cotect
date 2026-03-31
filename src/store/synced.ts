import { create, type StateCreator, type StoreApi } from 'zustand'
import { loadPanelState, savePanelState, clearPanelState } from '@/services/panelState'

function isSerializable(value: unknown): boolean {
  if (value === null || value === undefined) return true
  const type = typeof value
  if (type === 'function') return false
  if (type !== 'object') return true
  if (Array.isArray(value)) return true
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** Determine which keys are serializable from initial state (computed once at store creation). */
function computeSerializableKeys(state: Record<string, unknown>): Set<string> {
  const keys = new Set<string>()
  for (const [key, value] of Object.entries(state)) {
    if (isSerializable(value)) keys.add(key)
  }
  return keys
}

function pickKeys<T>(state: T, keys: Set<string>): Partial<T> {
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    result[key] = (state as Record<string, unknown>)[key]
  }
  return result as Partial<T>
}

interface PendingEntry {
  name: string
  store: StoreApi<unknown>
  serializableKeys: Set<string>
  sanitize?: (s: Partial<unknown>) => Partial<unknown>
}

const pending: PendingEntry[] = []

interface SyncOptions<T> {
  sanitize?: (saved: Partial<T>) => Partial<T>
}

/**
 * Drop-in replacement for Zustand's `create` that auto-syncs state to a shared file.
 * Functions and non-serializable values (class instances) are excluded automatically.
 */
export function createSyncedStore<T>(name: string, creator: StateCreator<T>, options?: SyncOptions<T>) {
  const store = create<T>(creator)
  const serializableKeys = computeSerializableKeys(store.getState() as Record<string, unknown>)
  pending.push({
    name,
    store: store as unknown as StoreApi<unknown>,
    serializableKeys,
    sanitize: options?.sanitize as ((s: Partial<unknown>) => Partial<unknown>) | undefined,
  })
  return store
}

/**
 * Call once after Neutralino init. Starts auto-saving for all synced stores.
 * Does NOT load saved state — call clearAllSyncedStores() first on main window startup
 * to ensure a fresh session, then stores save as they change.
 */
export function initAllSyncedStores(): void {
  for (const { name, store, serializableKeys } of pending) {
    let timer: ReturnType<typeof setTimeout> | null = null
    store.subscribe(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        savePanelState(name, pickKeys(store.getState(), serializableKeys))
      }, 300)
    })
  }
}

/**
 * Clear all saved panel state files (call on main window startup for a fresh session).
 */
export function clearAllSyncedStores(): void {
  for (const { name } of pending) {
    clearPanelState(name)
  }
}

/**
 * Reload a specific store from the shared file (call when receiving a panel via cross-window drop).
 */
export async function reloadSyncedStore(name: string): Promise<void> {
  const entry = pending.find((p) => p.name === name)
  if (!entry) return
  const saved = await loadPanelState(name)
  if (saved && typeof saved === 'object') {
    entry.store.setState(entry.sanitize ? entry.sanitize(saved as Partial<unknown>) : saved)
  }
}
