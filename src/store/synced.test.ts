import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the platform module before anything imports it
const mockSet = vi.fn()
const mockGet = vi.fn().mockResolvedValue(null)
const mockClear = vi.fn().mockResolvedValue(undefined)
const mockSyncListen = vi.fn().mockReturnValue(() => {})

vi.mock('@/services/platform', () => ({
  getPlatform: () => ({
    windows: {
      getWindowId: () => 'test-window',
    },
    syncedState: {
      set: mockSet,
      get: mockGet,
      clear: mockClear,
      listen: mockSyncListen,
    },
  }),
}))

import { createSyncedStore, initAllSyncedStores, stopAllSyncedStores, clearAllSyncedStores, loadSyncedStoreFromBackend } from './synced'

describe('synced store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stopAllSyncedStores()
    // Default: get returns null (no saved state) for any store
    mockGet.mockResolvedValue(null)
  })

  describe('createSyncedStore', () => {
    it('creates a working zustand store', () => {
      const store = createSyncedStore<{ count: number; inc: () => void }>('test-counter', (set) => ({
        count: 0,
        inc: () => set((s) => ({ count: s.count + 1 })),
      }))

      expect(store.getState().count).toBe(0)
      store.getState().inc()
      expect(store.getState().count).toBe(1)
    })

    it('store functions as a normal zustand store before init', () => {
      const store = createSyncedStore<{ value: string }>('test-value', () => ({
        value: 'initial',
      }))

      store.setState({ value: 'updated' })
      expect(store.getState().value).toBe('updated')
    })
  })

  describe('initAllSyncedStores', () => {
    it('sets up outbound sync (store changes push to platform)', () => {
      const store = createSyncedStore<{ data: string; action: () => void }>('test-outbound', (set) => ({
        data: 'hello',
        action: () => set({ data: 'changed' }),
      }))

      initAllSyncedStores()

      // Trigger a store change
      store.getState().action()

      // Should have pushed the serializable data (not the function) to the platform
      expect(mockSet).toHaveBeenCalledWith('test-outbound', expect.objectContaining({ data: 'changed' }), 'test-window')
      // Should not include the function key
      const outboundCalls = mockSet.mock.calls.filter((c: unknown[]) => c[0] === 'test-outbound')
      const pushedData = outboundCalls[outboundCalls.length - 1][1]
      expect(pushedData).not.toHaveProperty('action')
    })

    it('sets up inbound sync listener', () => {
      createSyncedStore<{ data: string }>('test-inbound', () => ({
        data: 'original',
      }))

      initAllSyncedStores()

      // listen should have been called with the store name
      expect(mockSyncListen).toHaveBeenCalledWith('test-inbound', expect.any(Function))
    })

    it('loads initial state from backend', async () => {
      // Return specific data only for the target store
      const store = createSyncedStore<{ data: string }>('test-load', () => ({
        data: 'initial',
      }))

      mockGet.mockImplementation((name: string) => {
        if (name === 'test-load') return Promise.resolve({ data: 'from-backend' })
        return Promise.resolve(null)
      })

      initAllSyncedStores()

      // Wait for the async initial load
      await vi.waitFor(() => {
        expect(store.getState().data).toBe('from-backend')
      })
    })

    it('applies sanitize function on initial load', async () => {
      const store = createSyncedStore<{ data: string; transient: boolean }>(
        'test-sanitize',
        () => ({ data: 'initial', transient: false }),
        { sanitize: (saved) => ({ ...saved, transient: false }) },
      )

      mockGet.mockImplementation((name: string) => {
        if (name === 'test-sanitize') return Promise.resolve({ data: 'loaded', transient: true })
        return Promise.resolve(null)
      })

      initAllSyncedStores()

      await vi.waitFor(() => {
        expect(store.getState().data).toBe('loaded')
        expect(store.getState().transient).toBe(false)
      })
    })

    it('ignores null initial state from backend', async () => {
      const store = createSyncedStore<{ data: string }>('test-null-load', () => ({
        data: 'keep-me',
      }))

      initAllSyncedStores()

      // Give async load time to resolve
      await new Promise((r) => setTimeout(r, 10))
      expect(store.getState().data).toBe('keep-me')
    })
  })

  describe('stopAllSyncedStores', () => {
    it('clears all listeners', () => {
      const unlisten = vi.fn()
      mockSyncListen.mockReturnValue(unlisten)

      createSyncedStore<{ v: number }>('test-stop', () => ({ v: 0 }))
      initAllSyncedStores()

      stopAllSyncedStores()
      expect(unlisten).toHaveBeenCalled()
    })
  })

  describe('clearAllSyncedStores', () => {
    it('calls clear for each registered store', () => {
      createSyncedStore<{ a: number }>('clear-a', () => ({ a: 1 }))
      createSyncedStore<{ b: number }>('clear-b', () => ({ b: 2 }))

      clearAllSyncedStores()

      expect(mockClear).toHaveBeenCalledWith('clear-a')
      expect(mockClear).toHaveBeenCalledWith('clear-b')
    })
  })

  describe('loadSyncedStoreFromBackend', () => {
    it('loads state into the matching store', async () => {
      const store = createSyncedStore<{ val: string }>('test-backend-load', () => ({
        val: 'old',
      }))

      mockGet.mockResolvedValueOnce({ val: 'new-from-backend' })
      await loadSyncedStoreFromBackend('test-backend-load')

      expect(store.getState().val).toBe('new-from-backend')
    })

    it('no-ops for unknown store name', async () => {
      await loadSyncedStoreFromBackend('nonexistent-store-xyz')
      // get should not be called for unknown stores
      expect(mockGet).not.toHaveBeenCalled()
    })

    it('no-ops when backend returns null', async () => {
      const store = createSyncedStore<{ val: string }>('test-null-backend', () => ({
        val: 'unchanged',
      }))

      mockGet.mockResolvedValueOnce(null)
      await loadSyncedStoreFromBackend('test-null-backend')

      expect(store.getState().val).toBe('unchanged')
    })
  })
})
