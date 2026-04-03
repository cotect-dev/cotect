import type { StoreApi } from 'zustand'
import type { ViteHotContext } from 'vite/types/hot'

/**
 * Preserve a Zustand store's state across Vite HMR module reloads.
 *
 * Call this at the end of each store file:
 *   preserveStoreOnHMR(import.meta.hot, 'storeName', useMyStore)
 *
 * On module dispose (before HMR re-execution), the current state is
 * serialized into import.meta.hot.data. When the module re-executes,
 * the saved state is restored into the newly created store, keeping
 * only data properties (functions are from the fresh store creator).
 */
export function preserveStoreOnHMR<T>(
  hot: ViteHotContext | undefined,
  key: string,
  store: StoreApi<T>,
): void {
  if (!hot || !hot.data) return

  // Restore state from a previous HMR cycle if available
  const saved = hot.data[key] as Record<string, unknown> | undefined
  if (saved) {
    // Only restore non-function properties — the new module has fresh action implementations
    const currentState = store.getState() as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(saved)) {
      if (typeof currentState[k] !== 'function') {
        patch[k] = v
      }
    }
    store.setState(patch as Partial<T>)
  }

  // Before the next HMR update, snapshot all non-function state
  hot.dispose((data) => {
    const state = store.getState() as Record<string, unknown>
    const snapshot: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(state)) {
      if (typeof v !== 'function') {
        snapshot[k] = v
      }
    }
    data[key] = snapshot
  })
}
