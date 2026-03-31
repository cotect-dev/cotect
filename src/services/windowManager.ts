import { filesystem, window as neuWindow } from '@neutralinojs/lib'
import { isNeutralino } from './platform'
import type { PanelPosition } from '@/store/layout'
import { useBrowserStore } from '@/store/browser'

const FILE_PREFIX = '/tmp/cotect-wm-'
const LS_PREFIX = 'cotect:'

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

// --- Read/write helpers ---

async function fileRead(key: string): Promise<string | null> {
  if (isNeutralino()) {
    try {
      return await filesystem.readFile(`${FILE_PREFIX}${key}.json`)
    } catch {
      return null
    }
  } else {
    try {
      return localStorage.getItem(`${LS_PREFIX}${key}`)
    } catch {
      return null
    }
  }
}

function fileWrite(key: string, data: string): void {
  if (isNeutralino()) {
    filesystem.writeFile(`${FILE_PREFIX}${key}.json`, data).catch(() => {})
  } else {
    try { localStorage.setItem(`${LS_PREFIX}${key}`, data) } catch {}
  }
}

function fileRemove(key: string): void {
  if (isNeutralino()) {
    filesystem.remove(`${FILE_PREFIX}${key}.json`).catch(() => {})
  } else {
    try { localStorage.removeItem(`${LS_PREFIX}${key}`) } catch {}
  }
}

// --- Window discovery (no registry — layout file existence = registration) ---

export async function getChildWindowIds(): Promise<string[]> {
  if (isNeutralino()) {
    try {
      const entries = await filesystem.readDirectory('/tmp')
      const prefix = 'cotect-wm-layout-'
      const ids: string[] = []
      for (const entry of entries) {
        if (entry.type === 'FILE' && entry.entry.startsWith(prefix) && entry.entry.endsWith('.json')) {
          const id = entry.entry.slice(prefix.length, -5) // remove prefix and .json
          if (id !== 'main') ids.push(id)
        }
      }
      return ids
    } catch {
      return []
    }
  } else {
    const ids: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(`${LS_PREFIX}layout-`) && !key.endsWith('-main')) {
        ids.push(key.slice(`${LS_PREFIX}layout-`.length))
      }
    }
    return ids
  }
}

// --- Layout persistence ---

export function saveLayout(windowId: string, layout: PersistedLayout): void {
  fileWrite(`layout-${windowId}`, JSON.stringify(layout))
}

export async function loadLayout(windowId: string): Promise<PersistedLayout | null> {
  try {
    const raw = await fileRead(`layout-${windowId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function removeLayout(windowId: string): void {
  fileRemove(`layout-${windowId}`)
  fileRemove(`zones-${windowId}`)
  fileRemove(`geometry-${windowId}`)
}

export function saveZoneSizes(windowId: string, sizes: PersistedZoneSizes): void {
  fileWrite(`zones-${windowId}`, JSON.stringify(sizes))
}

export async function loadZoneSizes(windowId: string): Promise<PersistedZoneSizes | null> {
  try {
    const raw = await fileRead(`zones-${windowId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export interface PersistedGeometry {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

export function saveGeometry(windowId: string, geometry: PersistedGeometry): void {
  fileWrite(`geometry-${windowId}`, JSON.stringify(geometry))
}

export async function loadGeometry(windowId: string): Promise<PersistedGeometry | null> {
  try {
    const raw = await fileRead(`geometry-${windowId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export interface PersistedSession {
  rootPath: string
  currentPath: string
  viewMode: 'directory' | 'file'
}

export function saveSession(session: PersistedSession): void {
  fileWrite('session-main', JSON.stringify(session))
}

export async function loadSession(): Promise<PersistedSession | null> {
  try {
    const raw = await fileRead('session-main')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

let geometryUnsub: (() => void) | null = null

export function startGeometryPersistence(windowId: string): void {
  if (geometryUnsub) geometryUnsub()
  if (!isNeutralino()) return

  let timer: ReturnType<typeof setInterval> | null = null

  // Poll every 2 seconds (no resize/move events available in Neutralino)
  let lastJson = ''
  timer = setInterval(async () => {
    try {
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
    } catch {
      // Window may be closing
    }
  }, 2000)

  geometryUnsub = () => {
    if (timer) clearInterval(timer)
    timer = null
  }
}

export function stopGeometryPersistence(): void {
  if (geometryUnsub) {
    geometryUnsub()
    geometryUnsub = null
  }
}

let sessionUnsub: (() => void) | null = null

export function startSessionPersistence(): void {
  if (sessionUnsub) sessionUnsub()

  let timer: ReturnType<typeof setTimeout> | null = null
  sessionUnsub = useBrowserStore.subscribe((state) => {
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
  if (sessionUnsub) {
    sessionUnsub()
    sessionUnsub = null
  }
}
