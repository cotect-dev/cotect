import { create, type StateCreator, type StoreApi } from 'zustand'
import { getPlatform } from '@/services/platform'

function computeSerializableKeys(state: Record<string, unknown>): Set<string> {
  const keys = new Set<string>()
  for (const [key, value] of Object.entries(state)) {
    if (typeof value !== 'function') keys.add(key)
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
  /** Applied when loading from persistent storage (app restart / reload). */
  sanitize?: (s: Partial<unknown>) => Partial<unknown>
  syncing: boolean
}

const pending: PendingEntry[] = []

interface SyncOptions<T> {
  /** Clean up transient state when restoring from persistent storage. */
  sanitize?: (saved: Partial<T>) => Partial<T>
}

export function createSyncedStore<T>(name: string, creator: StateCreator<T>, options?: SyncOptions<T>) {
  const store = create<T>(creator)
  const serializableKeys = computeSerializableKeys(store.getState() as Record<string, unknown>)
  pending.push({
    name,
    store: store as unknown as StoreApi<unknown>,
    serializableKeys,
    sanitize: options?.sanitize as ((s: Partial<unknown>) => Partial<unknown>) | undefined,
    syncing: false,
  })
  return store
}

let unlisteners: (() => void)[] = []

export function initAllSyncedStores(): void {
  const platform = getPlatform()
  const windowId = platform.windows.getWindowId()

  for (const entry of pending) {
    // --- outbound: store → backend (fire-and-forget, Rust handles batching) ---
    const unsub = entry.store.subscribe(() => {
      if (entry.syncing) return
      const data = pickKeys(entry.store.getState(), entry.serializableKeys)
      platform.syncedState.set(entry.name, data, windowId)
    })
    unlisteners.push(unsub)

    // --- inbound: backend → this store ---
    const unlisten = platform.syncedState.listen(entry.name, ({ state, source }) => {
      if (source !== windowId && state) {
        entry.syncing = true
        try {
          entry.store.setState(state as Partial<unknown>)
        } finally {
          entry.syncing = false
        }
      }
    })
    unlisteners.push(unlisten)

    // --- initial load from backend ---
    platform.syncedState.get(entry.name).then((state) => {
      if (state && typeof state === 'object') {
        entry.syncing = true
        try {
          entry.store.setState(entry.sanitize ? entry.sanitize(state as Partial<unknown>) : state as Partial<unknown>)
        } finally {
          entry.syncing = false
        }
      }
    }).catch((err) => {
      console.warn(`[synced] initial load failed for "${entry.name}":`, err)
    })
  }
}

export function clearAllSyncedStores(): void {
  const platform = getPlatform()
  for (const { name } of pending) {
    platform.syncedState.clear(name).catch((err) => {
      console.warn(`[synced] clear("${name}") failed:`, err)
    })
  }
}

export function stopAllSyncedStores(): void {
  for (const unlisten of unlisteners) {
    unlisten()
  }
  unlisteners = []
}

/**
 * Load a synced store's current state from the backend.
 * Used for cross-window panel transfers where the target window
 * needs to pick up the latest state immediately.
 */
export async function loadSyncedStoreFromBackend(name: string): Promise<void> {
  const platform = getPlatform()
  const entry = pending.find((p) => p.name === name)
  if (!entry) return
  const state = await platform.syncedState.get(name)
  if (state && typeof state === 'object') {
    entry.syncing = true
    try {
      entry.store.setState(state as Partial<unknown>)
    } finally {
      entry.syncing = false
    }
  }
}
