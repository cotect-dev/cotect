/* eslint-disable @typescript-eslint/no-explicit-any */
// HMR test uses `any` in store/hot-reload mocks — typing them precisely
// would require duplicating Vite's ImportMetaHot shape; the tests are the
// boundary so we accept the looseness here.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStoreWithHMR } from './hmr'

describe('createStoreWithHMR', () => {
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

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the factory result when hot is undefined', () => {
    const store = createMockStore({ count: 0, increment: () => {} })
    const result = createStoreWithHMR(undefined, 'test', () => store as any)
    expect(result).toBe(store)
  })

  it('returns the factory result when hot.data is undefined', () => {
    const store = createMockStore({ count: 0 })
    const hot = { data: undefined } as any
    const result = createStoreWithHMR(hot, 'test', () => store as any)
    expect(result).toBe(store)
  })

  it('stashes the store in hot.data on first load', () => {
    const store = createMockStore({ count: 0 })
    const hot = { data: {} as Record<string, unknown> } as any
    const result = createStoreWithHMR(hot, 'myStore', () => store as any)
    expect(result).toBe(store)
    expect(hot.data['__store__myStore']).toBe(store)
  })

  it('returns the original store on HMR re-execution (preserves instance identity)', () => {
    const hot = { data: {} as Record<string, unknown> } as any

    // First load
    const originalStore = createMockStore({ count: 42, action: vi.fn() })
    const first = createStoreWithHMR(hot, 'test', () => originalStore as any)
    expect(first).toBe(originalStore)

    // Simulate HMR re-execution — factory creates a fresh store
    const freshStore = createMockStore({ count: 0, action: vi.fn() })
    const second = createStoreWithHMR(hot, 'test', () => freshStore as any)

    // Must return the ORIGINAL store, not the fresh one
    expect(second).toBe(originalStore)
    expect(second).not.toBe(freshStore)
  })

  it('patches action functions from the fresh store into the original', () => {
    const hot = { data: {} as Record<string, unknown> } as any

    const originalAction = vi.fn()
    const originalStore = createMockStore({ count: 42, action: originalAction })
    createStoreWithHMR(hot, 'test', () => originalStore as any)

    // HMR re-execution with new action implementation
    const freshAction = vi.fn()
    const freshStore = createMockStore({ count: 0, action: freshAction })
    const result = createStoreWithHMR(hot, 'test', () => freshStore as any)

    // The action on the returned (original) store should be the fresh one
    expect(result.getState().action).toBe(freshAction)
    // But data should be preserved
    expect(result.getState().count).toBe(42)
  })

  it('preserves non-function state from the original store across HMR', () => {
    const hot = { data: {} as Record<string, unknown> } as any

    const originalStore = createMockStore({
      count: 99,
      name: 'original',
      items: [1, 2, 3],
      doSomething: () => {},
    })
    createStoreWithHMR(hot, 'test', () => originalStore as any)

    // HMR re-execution with default values
    const freshStore = createMockStore({
      count: 0,
      name: 'fresh',
      items: [] as number[],
      doSomething: () => {},
    })
    const result = createStoreWithHMR(hot, 'test', () => freshStore as any)

    // Data state must be preserved from the original
    expect(result.getState().count).toBe(99)
    expect(result.getState().name).toBe('original')
    expect(result.getState().items).toEqual([1, 2, 3])
  })

  it('handles stores with complex non-function data types', () => {
    const hot = { data: {} as Record<string, unknown> } as any

    const originalStore = createMockStore({
      map: new Map([['a', 1]]),
      set: new Set([1, 2, 3]),
      nested: { x: { y: 'deep' } },
      action: () => {},
    })
    createStoreWithHMR(hot, 'complex', () => originalStore as any)

    // HMR re-execution
    const freshStore = createMockStore({
      map: new Map(),
      set: new Set(),
      nested: { x: { y: '' } },
      action: () => {},
    })
    const result = createStoreWithHMR(hot, 'complex', () => freshStore as any)

    expect(result.getState().map).toBeInstanceOf(Map)
    expect(result.getState().map).toEqual(new Map([['a', 1]]))
    expect(result.getState().set).toBeInstanceOf(Set)
    expect(result.getState().set).toEqual(new Set([1, 2, 3]))
    expect(result.getState().nested).toEqual({ x: { y: 'deep' } })
  })

  it('uses different keys for different stores', () => {
    const hot = { data: {} as Record<string, unknown> } as any

    const store1 = createMockStore({ a: 1 })
    const store2 = createMockStore({ b: 2 })
    createStoreWithHMR(hot, 'store1', () => store1 as any)
    createStoreWithHMR(hot, 'store2', () => store2 as any)

    expect(hot.data['__store__store1']).toBe(store1)
    expect(hot.data['__store__store2']).toBe(store2)
  })

  it('does not overwrite data properties with fresh defaults on HMR', () => {
    const hot = { data: {} as Record<string, unknown> } as any

    const originalFn = vi.fn()
    const originalStore = createMockStore({ count: 100, action: originalFn })
    createStoreWithHMR(hot, 'test', () => originalStore as any)

    // HMR re-execution: fresh store has count: 0 (the default)
    const freshFn = vi.fn()
    const freshStore = createMockStore({ count: 0, action: freshFn })
    const result = createStoreWithHMR(hot, 'test', () => freshStore as any)

    // count should NOT be reset to 0 — original's 100 is preserved
    expect(result.getState().count).toBe(100)
    // action should be the fresh one
    expect(result.getState().action).toBe(freshFn)
  })
})
