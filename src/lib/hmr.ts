import type { StoreApi } from 'zustand'
import type { ViteHotContext } from 'vite/types/hot'

/**
 * Preserve a Zustand store across Vite HMR module reloads.
 *
 * Wrap the `create()` call at each store's export:
 *
 *   export const useMyStore = createStoreWithHMR(
 *     import.meta.hot, 'storeName',
 *     () => create<MyState>((set, get) => ({ ... })),
 *   )
 *
 * **How it works:**
 *
 * On the first load, the factory runs and the resulting store is stashed in
 * `import.meta.hot.data` for the next cycle. On subsequent HMR re-executions
 * the factory still runs (so the fresh code is evaluated), but the *original*
 * store instance is returned — keeping every React subscription alive. Only
 * the action functions (typeof === 'function') from the freshly-created store
 * are patched into the original, so new code takes effect immediately while
 * all data state is preserved.
 */
export function createStoreWithHMR<T>(
  hot: ViteHotContext | undefined,
  key: string,
  factory: () => StoreApi<T>,
): StoreApi<T> {
  const fresh = factory()

  if (!hot || !hot.data) return fresh

  const storeKey = `__store__${key}`
  const existing = hot.data[storeKey] as StoreApi<T> | undefined

  if (existing) {
    // HMR re-execution: the original store instance is still alive and
    // React components are subscribed to it. Patch only the function
    // properties (actions) from the freshly-created store so new code
    // takes effect, but preserve all data state.
    const freshState = fresh.getState() as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(freshState)) {
      if (typeof v === 'function') {
        patch[k] = v
      }
    }
    existing.setState(patch as Partial<T>)
    return existing
  }

  // First load — stash the store instance for future HMR cycles
  hot.data[storeKey] = fresh
  return fresh
}
