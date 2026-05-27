import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PersistedLayout } from '@/types/layout'

const storage = new Map<string, unknown>()

const mockPlatform = {
  isWayland: vi.fn().mockResolvedValue(false),
  windows: {
    getWindowId: () => 'main',
    getPosition: vi.fn().mockResolvedValue({ x: 100, y: 200 }),
    getSize: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
    move: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    isMaximized: vi.fn().mockResolvedValue(false),
    onMoved: vi.fn().mockResolvedValue(() => {}),
    onResized: vi.fn().mockResolvedValue(() => {}),
    getWindowMonitor: vi.fn().mockResolvedValue(null),
    setWindowOnMonitor: vi.fn().mockResolvedValue(true),
    getMonitors: vi.fn().mockResolvedValue([]),
  },
  storage: {
    get: vi.fn(async (key: string) => storage.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      storage.set(key, value)
    }),
    setSync: vi.fn((key: string, value: unknown) => {
      storage.set(key, value)
    }),
    remove: vi.fn(async (key: string) => {
      storage.delete(key)
    }),
    removeSync: vi.fn((key: string) => {
      storage.delete(key)
    }),
    exists: vi.fn(async (key: string) => storage.has(key)),
    listKeys: vi.fn(async (prefix: string) =>
      [...storage.keys()].filter((k) => k.startsWith(prefix)),
    ),
  },
  syncedState: {
    set: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    clear: vi.fn(),
    listen: vi.fn().mockReturnValue(() => {}),
  },
}

vi.mock('@/services/platform', () => ({
  getPlatform: () => mockPlatform,
}))

vi.mock('@/store/browser', () => ({
  useBrowserStore: {
    subscribe: vi.fn().mockReturnValue(() => {}),
  },
}))

import {
  saveLayout,
  loadLayout,
  removeLayout,
  saveGeometry,
  loadGeometry,
  saveSession,
  loadSession,
  getChildWindowIds,
  restoreGeometryOnMonitor,
  type PersistedGeometry,
  type PersistedSession,
} from './windowManager'

describe('windowManager', () => {
  beforeEach(() => {
    storage.clear()
    vi.clearAllMocks()
    mockPlatform.storage.get.mockImplementation(async (key: string) => storage.get(key) ?? null)
    mockPlatform.storage.set.mockImplementation(async (key: string, value: unknown) => {
      storage.set(key, value)
    })
    mockPlatform.storage.setSync.mockImplementation((key: string, value: unknown) => {
      storage.set(key, value)
    })
    mockPlatform.storage.remove.mockImplementation(async (key: string) => {
      storage.delete(key)
    })
    mockPlatform.storage.removeSync.mockImplementation((key: string) => {
      storage.delete(key)
    })
    mockPlatform.storage.exists.mockImplementation(async (key: string) => storage.has(key))
    mockPlatform.storage.listKeys.mockImplementation(async (prefix: string) =>
      [...storage.keys()].filter((k) => k.startsWith(prefix)),
    )
  })

  describe('layout persistence', () => {
    const layout: PersistedLayout = {
      panels: { left: [['browser']], right: [['tasks']], bottom: [['console']] } as Record<
        string,
        string[][]
      >,
      sizes: { left: [1], right: [1], bottom: [1] } as Record<string, number[]>,
      activeTab: { browser: 0 },
    }

    it('saves and loads layout for a window', async () => {
      saveLayout('main', layout)
      const loaded = await loadLayout('main')
      expect(loaded).toEqual(layout)
    })

    it('returns null for missing layout', async () => {
      const loaded = await loadLayout('nonexistent')
      expect(loaded).toBeNull()
    })

    it('removes layout and associated data', () => {
      saveLayout('win-1', layout)
      mockPlatform.storage.setSync('wm-zones-win-1', { left: 200, right: 300, bottom: 150 })
      saveGeometry('win-1', { x: 0, y: 0, width: 800, height: 600, isMaximized: false })

      removeLayout('win-1')

      expect(storage.has('wm-layout-win-1')).toBe(false)
      expect(storage.has('wm-zones-win-1')).toBe(false)
      expect(storage.has('wm-geometry-win-1')).toBe(false)
    })
  })

  describe('geometry persistence', () => {
    const geometry: PersistedGeometry = {
      x: 100,
      y: 200,
      width: 1024,
      height: 768,
      isMaximized: false,
    }

    it('saves and loads geometry', async () => {
      saveGeometry('main', geometry)
      const loaded = await loadGeometry('main')
      expect(loaded).toEqual(geometry)
    })

    it('returns null for missing geometry', async () => {
      expect(await loadGeometry('unknown')).toBeNull()
    })
  })

  describe('session persistence', () => {
    const session: PersistedSession = { rootPath: '/projects/app' }

    it('saves and loads session', async () => {
      saveSession(session)
      const loaded = await loadSession()
      expect(loaded).toEqual(session)
    })

    it('returns null when no session saved', async () => {
      expect(await loadSession()).toBeNull()
    })
  })

  describe('getChildWindowIds', () => {
    it('returns stored child IDs when available', async () => {
      storage.set('wm-children', ['child-1', 'child-2'])
      const ids = await getChildWindowIds()
      expect(ids).toEqual(['child-1', 'child-2'])
    })

    it('falls back to scanning layout keys', async () => {
      storage.set('wm-layout-main', {})
      storage.set('wm-layout-child-1', {})
      storage.set('wm-layout-child-2', {})

      const ids = await getChildWindowIds()
      expect(ids).toContain('child-1')
      expect(ids).toContain('child-2')
      expect(ids).not.toContain('main')
    })

    it('returns empty array when nothing is stored', async () => {
      const ids = await getChildWindowIds()
      expect(ids).toEqual([])
    })
  })

  describe('restoreGeometryOnMonitor', () => {
    it('moves window to saved position on non-Wayland', async () => {
      mockPlatform.isWayland.mockResolvedValue(false)
      const geometry: PersistedGeometry = {
        x: 150,
        y: 250,
        width: 800,
        height: 600,
        isMaximized: false,
      }

      await restoreGeometryOnMonitor('main', geometry, mockPlatform as never)

      expect(mockPlatform.windows.move).toHaveBeenCalledWith(150, 250)
    })

    it('uses setWindowOnMonitor on Wayland when monitor matches', async () => {
      mockPlatform.isWayland.mockResolvedValue(true)
      mockPlatform.windows.getMonitors.mockResolvedValue([
        {
          index: 0,
          model: 'DELL U2720Q',
          manufacturer: 'Dell Inc.',
          x: 0,
          y: 0,
          width: 2560,
          height: 1440,
          scale_factor: 1.0,
        },
      ])

      const geometry: PersistedGeometry = {
        x: 100,
        y: 200,
        width: 800,
        height: 600,
        isMaximized: false,
        monitorInfo: {
          monitor_model: 'DELL U2720Q',
          monitor_manufacturer: 'Dell Inc.',
          monitor_x: 0,
          monitor_y: 0,
          monitor_width: 2560,
          monitor_height: 1440,
          scale_factor: 1.0,
        },
      }

      await restoreGeometryOnMonitor('main', geometry, mockPlatform as never)

      expect(mockPlatform.windows.setWindowOnMonitor).toHaveBeenCalledWith('main', 0)
      expect(mockPlatform.windows.move).not.toHaveBeenCalled()
    })

    it('falls back to move on Wayland when monitor not found', async () => {
      mockPlatform.isWayland.mockResolvedValue(true)
      mockPlatform.windows.getMonitors.mockResolvedValue([])

      const geometry: PersistedGeometry = {
        x: 100,
        y: 200,
        width: 800,
        height: 600,
        isMaximized: false,
        monitorInfo: {
          monitor_model: 'Unknown',
          monitor_manufacturer: 'Unknown',
          monitor_x: 0,
          monitor_y: 0,
          monitor_width: 1920,
          monitor_height: 1080,
          scale_factor: 1.0,
        },
      }

      await restoreGeometryOnMonitor('main', geometry, mockPlatform as never)

      expect(mockPlatform.windows.move).toHaveBeenCalledWith(100, 200)
    })

    it('falls back to move on Wayland when no monitorInfo saved', async () => {
      mockPlatform.isWayland.mockResolvedValue(true)
      const geometry: PersistedGeometry = {
        x: 50,
        y: 75,
        width: 800,
        height: 600,
        isMaximized: false,
      }

      await restoreGeometryOnMonitor('main', geometry, mockPlatform as never)

      expect(mockPlatform.windows.move).toHaveBeenCalledWith(50, 75)
    })
  })
})
