import type { StoreApi } from 'zustand'

type ViteHotContext = NonNullable<ImportMeta['hot']>

/**
 * Preserve a Zustand store across Vite HMR module reloads.
 *
 * Usage:
 *   export const useMyStore = createStoreWithHMR(
 *     import.meta.hot, 'storeName',
 *     () => create<MyState>((set, get) => ({ ... })),
 *   )
 *
 * On HMR re-execution the factory still runs (so fresh code is evaluated),
 * but the *original* store instance is returned to keep React subscriptions
 * alive. Only function properties (actions) are patched from the new code;
 * data state is preserved.
 */
export function createStoreWithHMR<S extends StoreApi<unknown>>(
  hot: ViteHotContext | undefined,
  key: string,
  factory: () => S,
): S {
  const fresh = factory()

  if (!hot || !hot.data) return fresh

  const storeKey = `__store__${key}`
  const existing = hot.data[storeKey] as S | undefined

  if (existing) {
    const freshState = fresh.getState() as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(freshState)) {
      if (typeof v === 'function') {
        patch[k] = v
      }
    }
    ;(existing.setState as (partial: Record<string, unknown>) => void)(patch)
    return existing
  }

  hot.data[storeKey] = fresh
  return fresh
}
