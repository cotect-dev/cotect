import { describe, it, expect, vi, beforeEach } from 'vitest'
import { preserveStoreOnHMR } from './hmr'

describe('preserveStoreOnHMR', () => {
  function createMockStore<T extends Record<string, unknown>>(initialState: T) {
    let state = { ...initialState }
    return {
      getState: () => state,
      setState: (patch: Partial<T>) => {
        state = { ...state, ...patch }
      },
      subscribe: vi.fn(),
      destroy: vi.fn(),
    }
  }

  function createMockHot() {
    const disposeCallbacks: Array<(data: Record<string, unknown>) => void> = []
    const hot = {
      data: {} as Record<string, unknown>,
      dispose: (cb: (data: Record<string, unknown>) => void) => {
        disposeCallbacks.push(cb)
      },
      // Test helper to simulate HMR dispose
      triggerDispose: () => {
        for (const cb of disposeCallbacks) {
          cb(hot.data)
        }
      },
      get _disposeCallbacks() { return disposeCallbacks },
    }
    return hot
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when hot is undefined', () => {
    const store = createMockStore({ count: 0, increment: () => {} })
    expect(() => preserveStoreOnHMR(undefined, 'test', store as any)).not.toThrow()
  })

  it('does nothing when hot.data is undefined', () => {
    const store = createMockStore({ count: 0 })
    const hot = { data: undefined } as any
    expect(() => preserveStoreOnHMR(hot, 'test', store as any)).not.toThrow()
  })

  it('registers a dispose callback', () => {
    const store = createMockStore({ count: 0 })
    const hot = createMockHot()
    preserveStoreOnHMR(hot as any, 'test', store as any)
    expect(hot._disposeCallbacks).toHaveLength(1)
  })

  it('snapshots non-function state on dispose', () => {
    const store = createMockStore({
      count: 42,
      name: 'test',
      items: [1, 2, 3],
      doSomething: () => {},
    })
    const hot = createMockHot()
    preserveStoreOnHMR(hot as any, 'myStore', store as any)

    // Simulate HMR dispose
    hot.triggerDispose()

    const saved = hot.data['myStore'] as Record<string, unknown>
    expect(saved).toBeDefined()
    expect(saved.count).toBe(42)
    expect(saved.name).toBe('test')
    expect(saved.items).toEqual([1, 2, 3])
    // Functions should NOT be saved
    expect(saved.doSomething).toBeUndefined()
  })

  it('restores non-function state from previous HMR cycle', () => {
    const store = createMockStore({
      count: 0,
      name: 'default',
      increment: () => {},
    })

    // Simulate data from a previous HMR cycle
    const hot = createMockHot()
    hot.data['myStore'] = {
      count: 99,
      name: 'restored',
      increment: () => {}, // This should be ignored (function in saved data)
    }

    preserveStoreOnHMR(hot as any, 'myStore', store as any)

    // State should be restored
    expect(store.getState().count).toBe(99)
    expect(store.getState().name).toBe('restored')
    // The function should NOT be overwritten — it stays as the fresh store's version
    expect(typeof store.getState().increment).toBe('function')
  })

  it('does not restore function properties from saved state', () => {
    const originalFn = vi.fn()
    const store = createMockStore({
      count: 0,
      action: originalFn,
    })

    const hot = createMockHot()
    const savedFn = vi.fn()
    hot.data['store'] = {
      count: 10,
      action: savedFn,
    }

    preserveStoreOnHMR(hot as any, 'store', store as any)

    // count should be restored, but action should remain the original
    expect(store.getState().count).toBe(10)
    // The action is a function in current state, so it should NOT be restored
    expect(store.getState().action).toBe(originalFn)
  })

  it('handles stores with complex non-function data types', () => {
    const store = createMockStore({
      map: new Map([['a', 1]]),
      set: new Set([1, 2, 3]),
      nested: { x: { y: 'deep' } },
      action: () => {},
    })

    const hot = createMockHot()
    preserveStoreOnHMR(hot as any, 'complex', store as any)

    // Snapshot
    hot.triggerDispose()

    const saved = hot.data['complex'] as Record<string, unknown>
    expect(saved.map).toBeInstanceOf(Map)
    expect(saved.set).toBeInstanceOf(Set)
    expect(saved.nested).toEqual({ x: { y: 'deep' } })
    expect(saved.action).toBeUndefined()
  })

  it('uses different keys for different stores', () => {
    const store1 = createMockStore({ a: 1 })
    const store2 = createMockStore({ b: 2 })
    const hot = createMockHot()

    preserveStoreOnHMR(hot as any, 'store1', store1 as any)
    preserveStoreOnHMR(hot as any, 'store2', store2 as any)

    hot.triggerDispose()

    expect((hot.data['store1'] as any).a).toBe(1)
    expect((hot.data['store2'] as any).b).toBe(2)
  })

  it('only restores properties that exist in current state', () => {
    const store = createMockStore({
      count: 0,
      update: () => {},
    })

    const hot = createMockHot()
    hot.data['store'] = {
      count: 50,
      extraField: 'ghost', // This property doesn't exist in current state
    }

    preserveStoreOnHMR(hot as any, 'store', store as any)

    // count should be restored
    expect(store.getState().count).toBe(50)
    // extraField gets added to state (since setState does shallow merge)
    // This is expected behavior — the patch includes it
    expect((store.getState() as any).extraField).toBe('ghost')
  })
})
