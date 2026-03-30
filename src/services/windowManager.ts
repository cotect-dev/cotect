import { filesystem } from '@neutralinojs/lib'
import { isNeutralino } from './platform'
import type { PanelPosition } from '@/store/layout'

const FILE_PREFIX = '/tmp/cotect-wm-'
const LS_PREFIX = 'cotect:'

export interface WindowDescriptor {
  id: string
  role: 'main' | 'panel'
}

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

// --- Shared read/write helpers ---

function readFileSync(key: string): string | null {
  // For Neutralino, we need async reads but callers expect sync.
  // Use a cache that's populated by async reads.
  return fileCache.get(key) ?? null
}

// File cache for Neutralino mode (populated by async preload)
const fileCache = new Map<string, string>()

async function fileRead(key: string): Promise<string | null> {
  if (isNeutralino()) {
    try {
      const raw = await filesystem.readFile(`${FILE_PREFIX}${key}.json`)
      fileCache.set(key, raw)
      return raw
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
  fileCache.set(key, data)
  if (isNeutralino()) {
    filesystem.writeFile(`${FILE_PREFIX}${key}.json`, data).catch(() => {})
  } else {
    try { localStorage.setItem(`${LS_PREFIX}${key}`, data) } catch {}
  }
}

function fileRemove(key: string): void {
  fileCache.delete(key)
  if (isNeutralino()) {
    filesystem.remove(`${FILE_PREFIX}${key}.json`).catch(() => {})
  } else {
    try { localStorage.removeItem(`${LS_PREFIX}${key}`) } catch {}
  }
}

// --- Window registry ---

export async function getWindows(): Promise<WindowDescriptor[]> {
  try {
    const raw = await fileRead('windows')
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export async function registerWindow(id: string, role: 'main' | 'panel'): Promise<void> {
  const windows = await getWindows()
  const filtered = windows.filter((w) => w.id !== id)
  filtered.push({ id, role })
  fileWrite('windows', JSON.stringify(filtered))
}

export async function unregisterWindow(id: string): Promise<void> {
  const windows = await getWindows()
  const filtered = windows.filter((w) => w.id !== id)
  fileWrite('windows', JSON.stringify(filtered))
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
