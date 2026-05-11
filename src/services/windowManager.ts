import { getPlatform } from '@/services/platform'
import { useBrowserStore } from '@/store/browser'
import type { WindowMonitorInfo, MonitorInfo } from '@/services/platform/types'
import type { PersistedLayout } from '@/types/layout'

export type { PersistedLayout } from '@/types/layout'

const PERSIST_DEBOUNCE_MS = 300

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
}

export async function getChildWindowIds(): Promise<string[]> {
  const platform = getPlatform()
  // Falls back to scanning layout keys for first run / migration.
  const ids = await platform.storage.get<string[]>('wm-children')
  if (ids) return ids

  const keys = await platform.storage.listKeys('wm-layout-')
  return keys
    .map((k) => k.slice('wm-layout-'.length))
    .filter((id) => id !== 'main')
}

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

export function saveGeometry(windowId: string, geometry: PersistedGeometry): void {
  getPlatform().storage.setSync(`wm-geometry-${windowId}`, geometry)
}

export async function loadGeometry(windowId: string): Promise<PersistedGeometry | null> {
  return getPlatform().storage.get<PersistedGeometry>(`wm-geometry-${windowId}`)
}

export function saveSession(session: PersistedSession): void {
  getPlatform().storage.setSync('wm-session-main', session)
}

export async function loadSession(): Promise<PersistedSession | null> {
  return getPlatform().storage.get<PersistedSession>('wm-session-main')
}

let geometryCleanup: (() => void) | null = null

export async function startGeometryPersistence(windowId: string): Promise<void> {
  stopGeometryPersistence()

  const platform = getPlatform()
  const isWayland = await platform.isWayland()

  let pos = await platform.windows.getPosition()
  let size = await platform.windows.getSize()
  let lastJson = ''
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const persist = async () => {
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
  }

  const schedulePersist = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      persist().catch((err) => {
        console.warn('[windowManager] geometry persist failed:', err)
      })
    }, PERSIST_DEBOUNCE_MS)
  }

  persist().catch((err) => {
    console.warn('[windowManager] initial geometry persist failed:', err)
  })

  const cleanups: (() => void)[] = []

  const unlistenMove = await platform.windows.onMoved((p) => {
    pos = p
    schedulePersist()
  })
  cleanups.push(unlistenMove)

  const unlistenResize = await platform.windows.onResized((s) => {
    size = s
    schedulePersist()
  })
  cleanups.push(unlistenResize)

  geometryCleanup = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    for (const fn of cleanups) fn()
  }
}

export function stopGeometryPersistence(): void {
  geometryCleanup?.()
  geometryCleanup = null
}

let sessionPersister: (() => void) | null = null

export function startSessionPersistence(): void {
  sessionPersister?.()
  let timer: ReturnType<typeof setTimeout> | null = null
  sessionPersister = useBrowserStore.subscribe((state) => {
    if (!state.rootPath) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      saveSession({ rootPath: state.rootPath })
    }, PERSIST_DEBOUNCE_MS)
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

  await platform.windows.move(geometry.x, geometry.y).catch((err) => {
    console.warn('[windowManager] window move failed during geometry restore:', err)
  })
}
