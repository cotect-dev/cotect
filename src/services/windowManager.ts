import { getPlatform } from '@/services/platform'
import type { PanelPosition } from '@/store/layout'
import { useBrowserStore } from '@/store/browser'
import type { WindowMonitorInfo, MonitorInfo } from '@/services/platform/types'

export interface PersistedLayout {
  panels: Record<PanelPosition, string[][]>
  sizes: Record<PanelPosition, number[]>
  activeTab: Record<string, number>
}

export interface PersistedZoneSizes {
  left: number
  right: number
  bottom: number
}

export interface PersistedGeometry {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
  monitorInfo?: WindowMonitorInfo
}

export interface PersistedSession {
  rootPath: string
  currentPath: string
  viewMode: 'directory' | 'file'
}

// --- Window discovery ---

export async function getChildWindowIds(): Promise<string[]> {
  const platform = getPlatform()
  // Use the child list saved by the Rust side on shutdown (synchronous,
  // reliable). Falls back to scanning layout keys for first run / migration.
  const ids = await platform.storage.get<string[]>('wm-children')
  if (ids) return ids

  const keys = await platform.storage.listKeys('wm-layout-')
  return keys
    .map((k) => k.slice('wm-layout-'.length))
    .filter((id) => id !== 'main')
}

// --- Layout persistence ---

export function saveLayout(windowId: string, layout: PersistedLayout): void {
  getPlatform().storage.setSync(`wm-layout-${windowId}`, layout)
}

export async function loadLayout(windowId: string): Promise<PersistedLayout | null> {
  return getPlatform().storage.get<PersistedLayout>(`wm-layout-${windowId}`)
}

export function removeLayout(windowId: string): void {
  const platform = getPlatform()
  platform.storage.removeSync(`wm-layout-${windowId}`)
  platform.storage.removeSync(`wm-zones-${windowId}`)
  platform.storage.removeSync(`wm-geometry-${windowId}`)
}

// --- Zone sizes ---

export function saveZoneSizes(windowId: string, sizes: PersistedZoneSizes): void {
  getPlatform().storage.setSync(`wm-zones-${windowId}`, sizes)
}

export async function loadZoneSizes(windowId: string): Promise<PersistedZoneSizes | null> {
  return getPlatform().storage.get<PersistedZoneSizes>(`wm-zones-${windowId}`)
}

// --- Geometry ---

export function saveGeometry(windowId: string, geometry: PersistedGeometry): void {
  getPlatform().storage.setSync(`wm-geometry-${windowId}`, geometry)
}

export async function loadGeometry(windowId: string): Promise<PersistedGeometry | null> {
  return getPlatform().storage.get<PersistedGeometry>(`wm-geometry-${windowId}`)
}

// --- Session ---

export function saveSession(session: PersistedSession): void {
  getPlatform().storage.setSync('wm-session-main', session)
}

export async function loadSession(): Promise<PersistedSession | null> {
  return getPlatform().storage.get<PersistedSession>('wm-session-main')
}

// --- Polling persisters ---

interface Persister {
  start(): void
  stop(): void
}

function createPollingPersister(intervalMs: number, pollFn: () => Promise<void>): Persister {
  let timer: ReturnType<typeof setInterval> | null = null
  return {
    start() {
      if (timer) return
      timer = setInterval(() => { pollFn().catch(() => {}) }, intervalMs)
    },
    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
  }
}

let geometryPersister: Persister | null = null

export async function startGeometryPersistence(windowId: string): Promise<void> {
  geometryPersister?.stop()

  const platform = getPlatform()
  const isWayland = await platform.isWayland()

  let lastJson = ''
  geometryPersister = createPollingPersister(2000, async () => {
    const pos = await platform.windows.getPosition()
    const size = await platform.windows.getSize()
    const maximized = await platform.windows.isMaximized()

    let monitorInfo: WindowMonitorInfo | undefined
    if (isWayland) {
      monitorInfo = await platform.windows.getWindowMonitor(windowId) ?? undefined
    }

    const geometry: PersistedGeometry = {
      x: pos.x,
      y: pos.y,
      width: size.width,
      height: size.height,
      isMaximized: maximized,
      monitorInfo,
    }
    const json = JSON.stringify(geometry)
    if (json !== lastJson) {
      lastJson = json
      saveGeometry(windowId, geometry)
    }
  })
  geometryPersister.start()
}

export function stopGeometryPersistence(): void {
  geometryPersister?.stop()
  geometryPersister = null
}

let sessionPersister: (() => void) | null = null

export function startSessionPersistence(): void {
  sessionPersister?.()
  let timer: ReturnType<typeof setTimeout> | null = null
  sessionPersister = useBrowserStore.subscribe((state) => {
    if (!state.rootPath) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      saveSession({
        rootPath: state.rootPath,
        currentPath: state.currentPath,
        viewMode: state.viewMode,
      })
    }, 300)
  })
}

export function stopSessionPersistence(): void {
  sessionPersister?.()
  sessionPersister = null
}

export async function restoreGeometryOnMonitor(
  windowId: string,
  geometry: PersistedGeometry,
  platform: ReturnType<typeof getPlatform>
): Promise<void> {
  const isWayland = await platform.isWayland()

  if (isWayland && geometry.monitorInfo) {
    const monitors = await platform.windows.getMonitors()
    const targetMonitor = monitors.findIndex(
      (m: MonitorInfo) =>
        m.model === geometry.monitorInfo!.monitor_model &&
        m.manufacturer === geometry.monitorInfo!.monitor_manufacturer
    )
    if (targetMonitor >= 0) {
      await platform.windows.setWindowOnMonitor(windowId, targetMonitor)
      return
    }
  }

  if (geometry.x !== 0 || geometry.y !== 0) {
    await platform.windows.move(geometry.x, geometry.y).catch(() => {})
  }
}
