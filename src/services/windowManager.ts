import { window as neuWindow } from '@neutralinojs/lib'
import { isNeutralino } from './platform'
import { readJson, writeJsonSync, removeSync, listKeys } from './storage'
import type { PanelPosition } from '@/store/layout'
import { useBrowserStore } from '@/store/browser'

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
}

export interface PersistedSession {
  rootPath: string
  currentPath: string
  viewMode: 'directory' | 'file'
}

// --- Window discovery ---

export async function getChildWindowIds(): Promise<string[]> {
  const keys = await listKeys('wm-layout-')
  return keys
    .map((k) => k.slice('wm-layout-'.length))
    .filter((id) => id !== 'main')
}

// --- Layout persistence ---

export function saveLayout(windowId: string, layout: PersistedLayout): void {
  writeJsonSync(`wm-layout-${windowId}`, layout)
}

export async function loadLayout(windowId: string): Promise<PersistedLayout | null> {
  return readJson<PersistedLayout>(`wm-layout-${windowId}`)
}

export function removeLayout(windowId: string): void {
  removeSync(`wm-layout-${windowId}`)
  removeSync(`wm-zones-${windowId}`)
  removeSync(`wm-geometry-${windowId}`)
}

// --- Zone sizes ---

export function saveZoneSizes(windowId: string, sizes: PersistedZoneSizes): void {
  writeJsonSync(`wm-zones-${windowId}`, sizes)
}

export async function loadZoneSizes(windowId: string): Promise<PersistedZoneSizes | null> {
  return readJson<PersistedZoneSizes>(`wm-zones-${windowId}`)
}

// --- Geometry ---

export function saveGeometry(windowId: string, geometry: PersistedGeometry): void {
  writeJsonSync(`wm-geometry-${windowId}`, geometry)
}

export async function loadGeometry(windowId: string): Promise<PersistedGeometry | null> {
  return readJson<PersistedGeometry>(`wm-geometry-${windowId}`)
}

// --- Session ---

export function saveSession(session: PersistedSession): void {
  writeJsonSync('wm-session-main', session)
}

export async function loadSession(): Promise<PersistedSession | null> {
  return readJson<PersistedSession>('wm-session-main')
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

export function startGeometryPersistence(windowId: string): void {
  geometryPersister?.stop()
  if (!isNeutralino()) return

  let lastJson = ''
  geometryPersister = createPollingPersister(2000, async () => {
    const pos = await neuWindow.getPosition()
    const size = await neuWindow.getSize()
    const maximized = await neuWindow.isMaximized()
    const geometry: PersistedGeometry = {
      x: pos.x,
      y: pos.y,
      width: size.width ?? 800,
      height: size.height ?? 600,
      isMaximized: maximized,
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
