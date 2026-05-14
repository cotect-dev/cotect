import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { create } from 'zustand'

// Mock platform
const mockStorageGet = vi.fn().mockResolvedValue(null)
const mockStorageSetSync = vi.fn()
const mockSyncedSet = vi.fn()
const mockSyncedListen = vi.fn().mockReturnValue(() => {})
const mockGetWindowId = vi.fn().mockReturnValue('test-window')

vi.mock('@/services/platform', () => ({
  getPlatform: () => ({
    windows: { getWindowId: mockGetWindowId },
    storage: {
      get: mockStorageGet,
      setSync: mockStorageSetSync,
    },
    syncedState: {
      set: mockSyncedSet,
      listen: mockSyncedListen,
    },
  }),
}))

// Mock projectId
vi.mock('@/lib/projectId', () => ({
  computeProjectId: vi.fn().mockResolvedValue('test-project-abc12345'),
}))

import {
  withPersistence,
  initPersistence,
  stopPersistence,
  switchProject,
  flushPendingWrites,
  _testReset,
} from './persistence'

describe('persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    _testReset()
    mockStorageGet.mockResolvedValue(null)
  })

  afterEach(() => {
    stopPersistence()
    vi.useRealTimers()
  })

  describe('withPersistence middleware', () => {
    it('creates a working store with initial state', () => {
      const store = create(
        withPersistence<{ count: number; inc: () => void }>(
          (set) => ({
            count: 0,
            inc: () => set((s) => ({ count: s.count + 1 })),
          }),
          { name: 'test', fields: { count: { scope: 'global' } }, debounce: 100 },
        ),
      )

      expect(store.getState().count).toBe(0)
      store.getState().inc()
      expect(store.getState().count).toBe(1)
    })
  })

  describe('initPersistence', () => {
    it('loads saved global state and hydrates the store', async () => {
      mockStorageGet.mockImplementation((key: string) => {
        if (key === 'persist:global') return Promise.resolve({ 'mystore.width': 500 })
        return Promise.resolve(null)
      })

      const store = create(
        withPersistence<{ width: number }>(() => ({ width: 300 }), {
          name: 'mystore',
          fields: { width: { scope: 'global' } },
          debounce: 100,
        }),
      )

      await initPersistence('test-project-abc12345')

      expect(store.getState().width).toBe(500)
    })

    it('loads saved project state and hydrates the store', async () => {
      mockStorageGet.mockImplementation((key: string) => {
        if (key === 'persist:project:test-project-abc12345') {
          return Promise.resolve({ 'mystore.items': ['a', 'b'] })
        }
        return Promise.resolve(null)
      })

      const store = create(
        withPersistence<{ items: string[] }>(() => ({ items: [] }), {
          name: 'mystore',
          fields: { items: { scope: 'project' } },
          debounce: 100,
        }),
      )

      await initPersistence('test-project-abc12345')

      expect(store.getState().items).toEqual(['a', 'b'])
    })

    it('uses deserialize function when provided', async () => {
      mockStorageGet.mockImplementation((key: string) => {
        if (key === 'persist:project:test-project-abc12345') {
          return Promise.resolve({ 'mystore.ids': ['x', 'y'] })
        }
        return Promise.resolve(null)
      })

      const store = create(
        withPersistence<{ ids: Set<string> }>(() => ({ ids: new Set() }), {
          name: 'mystore',
          fields: {
            ids: {
              scope: 'project',
              serialize: (s: Set<string>) => [...s],
              deserialize: (arr: unknown) => new Set(arr as string[]),
            },
          },
          debounce: 100,
        }),
      )

      await initPersistence('test-project-abc12345')

      expect(store.getState().ids).toBeInstanceOf(Set)
      expect(store.getState().ids.has('x')).toBe(true)
      expect(store.getState().ids.has('y')).toBe(true)
    })
  })

  describe('debounced writes', () => {
    it('writes global field changes after debounce', async () => {
      const store = create(
        withPersistence<{ width: number }>(() => ({ width: 300 }), {
          name: 'mystore',
          fields: { width: { scope: 'global' } },
          debounce: 100,
        }),
      )

      await initPersistence('test-project-abc12345')
      mockStorageSetSync.mockClear()

      store.setState({ width: 500 })

      expect(mockStorageSetSync).not.toHaveBeenCalled()

      vi.advanceTimersByTime(150)

      expect(mockStorageSetSync).toHaveBeenCalledWith(
        'persist:global',
        expect.objectContaining({ 'mystore.width': 500 }),
      )
    })

    it('writes project field changes to the project namespace', async () => {
      const store = create(
        withPersistence<{ hidden: string[] }>(() => ({ hidden: [] }), {
          name: 'mystore',
          fields: { hidden: { scope: 'project' } },
          debounce: 100,
        }),
      )

      await initPersistence('test-project-abc12345')
      mockStorageSetSync.mockClear()

      store.setState({ hidden: ['node-1'] })
      vi.advanceTimersByTime(150)

      expect(mockStorageSetSync).toHaveBeenCalledWith(
        'persist:project:test-project-abc12345',
        expect.objectContaining({ 'mystore.hidden': ['node-1'] }),
      )
    })

    it('broadcasts changes via syncedState for cross-window sync', async () => {
      const store = create(
        withPersistence<{ width: number }>(() => ({ width: 300 }), {
          name: 'mystore',
          fields: { width: { scope: 'global' } },
          debounce: 100,
        }),
      )

      await initPersistence('test-project-abc12345')
      mockSyncedSet.mockClear()

      store.setState({ width: 500 })
      vi.advanceTimersByTime(150)

      expect(mockSyncedSet).toHaveBeenCalledWith(
        'persist:global',
        expect.objectContaining({ 'mystore.width': 500 }),
        'test-window',
      )
    })

    it('auto-converts Set to Array without custom serialize', async () => {
      const store = create(
        withPersistence<{ ids: Set<string> }>(() => ({ ids: new Set() }), {
          name: 'mystore',
          fields: { ids: { scope: 'global' } },
          debounce: 100,
        }),
      )

      await initPersistence('test-project-abc12345')
      mockStorageSetSync.mockClear()

      store.setState({ ids: new Set(['x', 'y']) })
      vi.advanceTimersByTime(150)

      expect(mockStorageSetSync).toHaveBeenCalledWith(
        'persist:global',
        expect.objectContaining({ 'mystore.ids': expect.arrayContaining(['x', 'y']) }),
      )
    })

    it('uses serialize function when provided', async () => {
      const store = create(
        withPersistence<{ ids: Set<string> }>(() => ({ ids: new Set() }), {
          name: 'mystore',
          fields: {
            ids: {
              scope: 'global',
              serialize: (s: Set<string>) => [...s],
              deserialize: (arr: unknown) => new Set(arr as string[]),
            },
          },
          debounce: 100,
        }),
      )

      await initPersistence('test-project-abc12345')
      mockStorageSetSync.mockClear()

      store.setState({ ids: new Set(['a', 'b']) })
      vi.advanceTimersByTime(150)

      expect(mockStorageSetSync).toHaveBeenCalledWith(
        'persist:global',
        expect.objectContaining({ 'mystore.ids': expect.arrayContaining(['a', 'b']) }),
      )
    })
  })

  describe('flushPendingWrites', () => {
    it('writes immediately without waiting for debounce', async () => {
      const store = create(
        withPersistence<{ val: number }>(() => ({ val: 0 }), {
          name: 'mystore',
          fields: { val: { scope: 'global' } },
          debounce: 5000,
        }),
      )

      await initPersistence('test-project-abc12345')
      mockStorageSetSync.mockClear()

      store.setState({ val: 42 })
      flushPendingWrites()

      expect(mockStorageSetSync).toHaveBeenCalledWith(
        'persist:global',
        expect.objectContaining({ 'mystore.val': 42 }),
      )
    })
  })

  describe('switchProject', () => {
    it('flushes writes and loads new project state', async () => {
      const store = create(
        withPersistence<{ items: string[] }>(() => ({ items: [] }), {
          name: 'mystore',
          fields: { items: { scope: 'project' } },
          debounce: 100,
        }),
      )

      await initPersistence('project-a')

      mockStorageGet.mockImplementation((key: string) => {
        if (key === 'persist:project:project-b') {
          return Promise.resolve({ 'mystore.items': ['from-b'] })
        }
        return Promise.resolve(null)
      })

      await switchProject('project-b')

      expect(store.getState().items).toEqual(['from-b'])
    })

    it('resets project fields to defaults when no saved state exists', async () => {
      const store = create(
        withPersistence<{ items: string[] }>(() => ({ items: ['default'] }), {
          name: 'mystore',
          fields: { items: { scope: 'project' } },
          debounce: 100,
        }),
      )

      await initPersistence('project-a')
      store.setState({ items: ['modified'] })

      mockStorageGet.mockResolvedValue(null)

      await switchProject('project-b')

      expect(store.getState().items).toEqual(['default'])
    })
  })
})
