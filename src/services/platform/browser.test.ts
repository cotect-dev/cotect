import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock BroadcastChannel with addEventListener/removeEventListener support
class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = []
  name: string
  onmessage: ((event: { data: unknown }) => void) | null = null
  postMessage = vi.fn()
  close = vi.fn()
  private listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map()
  constructor(name: string) {
    this.name = name
    MockBroadcastChannel.instances.push(this)
  }
  addEventListener(type: string, fn: (...args: unknown[]) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn)
  }
  removeEventListener(type: string, fn: (...args: unknown[]) => void) {
    this.listeners.get(type)?.delete(fn)
  }
  simulateMessage(data: unknown) {
    const handlers = this.listeners.get('message')
    if (handlers) {
      for (const h of handlers) h({ data })
    }
  }
}

// Install mock before import
vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)

const store: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value }),
  removeItem: vi.fn((key: string) => { delete store[key] }),
  clear: vi.fn(() => { for (const k of Object.keys(store)) delete store[k] }),
  get length() { return Object.keys(store).length },
  key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
}
vi.stubGlobal('localStorage', localStorageMock)

import { browserPlatform } from '@/services/platform/browser'

describe('browserPlatform.syncedState', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k]
    vi.clearAllMocks()
  })

  describe('set', () => {
    it('stores state in localStorage with cotect:panel- prefix', () => {
      browserPlatform.syncedState.set('test-store', { count: 42 }, 'win1')
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'cotect:panel-test-store',
        JSON.stringify({ count: 42 }),
      )
    })

    it('broadcasts via shared BroadcastChannel', () => {
      browserPlatform.syncedState.set('test-store', { count: 42 }, 'win1')
      const bc = MockBroadcastChannel.instances.find((i) => i.name === 'cotect')
      expect(bc).toBeDefined()
      expect(bc!.postMessage).toHaveBeenCalledWith({
        event: 'synced-state-update:test-store',
        payload: { state: { count: 42 }, source: 'win1' },
      })
    })
  })

  describe('get', () => {
    it('returns parsed state from localStorage', async () => {
      store['cotect:panel-my-store'] = JSON.stringify({ x: 1 })
      const result = await browserPlatform.syncedState.get('my-store')
      expect(result).toEqual({ x: 1 })
    })

    it('returns null for missing key', async () => {
      const result = await browserPlatform.syncedState.get('nonexistent')
      expect(result).toBeNull()
    })

    it('returns null for invalid JSON', async () => {
      store['cotect:panel-bad'] = '{invalid'
      const result = await browserPlatform.syncedState.get('bad')
      expect(result).toBeNull()
    })
  })

  describe('clear', () => {
    it('removes key from localStorage', async () => {
      store['cotect:panel-x'] = '{"a":1}'
      await browserPlatform.syncedState.clear('x')
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('cotect:panel-x')
    })
  })

  describe('listen', () => {
    it('returns an unlisten function', () => {
      const unlisten = browserPlatform.syncedState.listen('test', () => {})
      expect(typeof unlisten).toBe('function')
      unlisten() // cleanup
    })

    it('calls back on matching event', () => {
      const callback = vi.fn()
      browserPlatform.syncedState.listen('my-name', callback)

      const bc = MockBroadcastChannel.instances.find((i) => i.name === 'cotect')!
      bc.simulateMessage({
        event: 'synced-state-update:my-name',
        payload: { state: { val: 123 }, source: 'other-win' },
      })

      expect(callback).toHaveBeenCalledWith({ state: { val: 123 }, source: 'other-win' })
    })

    it('does not call back on non-matching event', () => {
      const callback = vi.fn()
      browserPlatform.syncedState.listen('my-name', callback)

      const bc = MockBroadcastChannel.instances.find((i) => i.name === 'cotect')!
      bc.simulateMessage({
        event: 'synced-state-update:other-name',
        payload: { state: {}, source: 'w' },
      })

      expect(callback).not.toHaveBeenCalled()
    })

    it('stops listening after unlisten', () => {
      const callback = vi.fn()
      const unlisten = browserPlatform.syncedState.listen('my-name', callback)
      unlisten()

      const bc = MockBroadcastChannel.instances.find((i) => i.name === 'cotect')!
      bc.simulateMessage({
        event: 'synced-state-update:my-name',
        payload: { state: {}, source: 'w' },
      })

      expect(callback).not.toHaveBeenCalled()
    })
  })
})
