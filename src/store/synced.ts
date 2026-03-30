import { create, type StateCreator, type StoreApi } from 'zustand'
import { loadPanelState, savePanelState } from '@/services/panelState'

function isSerializable(value: unknown): boolean {
  if (value === null || value === undefined) return true
  const type = typeof value
  if (type === 'function') return false
  if (type !== 'object') return true
  if (Array.isArray(value)) return true
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

// Stores registered for syncing — initialized later via initAllSyncedStores()
const pending: { name: string; store: StoreApi<unknown>; sanitize?: (s: Partial<unknown>) => Partial<unknown> }[] = []

interface SyncOptions<T> {
  /** Clean up runtime-only fields when loading saved state (e.g. clear isStreaming flags) */
  sanitize?: (saved: Partial<T>) => Partial<T>
}

/**
 * Drop-in replacement for Zustand's `create` that auto-syncs state to a shared file.
 * Functions and non-serializable values (class instances) are excluded automatically.
 *
 * Load and auto-save are deferred until initAllSyncedStores() is called
 * (after Neutralino init, so isNeutralino() returns the correct value).
 */
export function createSyncedStore<T>(name: string, creator: StateCreator<T>, options?: SyncOptions<T>) {
  const store = create<T>(creator)
  pending.push({ name, store: store as unknown as StoreApi<unknown>, sanitize: options?.sanitize as ((s: Partial<unknown>) => Partial<unknown>) | undefined })
  return store
}

/**
 * Call once after Neutralino init (or immediately in browser mode).
 * Loads saved state into each synced store and starts auto-saving.
 */
export function initAllSyncedStores(): void {
  for (const { name, store, sanitize } of pending) {
    // Load saved state
    loadPanelState(name).then((saved) => {
      if (saved && typeof saved === 'object') {
        store.setState(sanitize ? sanitize(saved as Partial<unknown>) : saved)
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
  }
}
