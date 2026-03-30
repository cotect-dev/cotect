import type { PanelPosition } from '@/store/layout'

const WINDOWS_KEY = 'cotect:windows'
const LAYOUT_PREFIX = 'cotect:layout:'
const ZONE_SIZES_PREFIX = 'cotect:zones:'

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

// --- Window registry ---

export function getWindows(): WindowDescriptor[] {
  try {
    return JSON.parse(localStorage.getItem(WINDOWS_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function registerWindow(id: string, role: 'main' | 'panel'): void {
  const windows = getWindows().filter((w) => w.id !== id)
  windows.push({ id, role })
  localStorage.setItem(WINDOWS_KEY, JSON.stringify(windows))
}

export function unregisterWindow(id: string): void {
  const windows = getWindows().filter((w) => w.id !== id)
  localStorage.setItem(WINDOWS_KEY, JSON.stringify(windows))
}

// --- Layout persistence ---

export function saveLayout(windowId: string, layout: PersistedLayout): void {
  localStorage.setItem(LAYOUT_PREFIX + windowId, JSON.stringify(layout))
}

export function loadLayout(windowId: string): PersistedLayout | null {
  try {
    const raw = localStorage.getItem(LAYOUT_PREFIX + windowId)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function removeLayout(windowId: string): void {
  localStorage.removeItem(LAYOUT_PREFIX + windowId)
  localStorage.removeItem(ZONE_SIZES_PREFIX + windowId)
}

export function saveZoneSizes(windowId: string, sizes: PersistedZoneSizes): void {
  localStorage.setItem(ZONE_SIZES_PREFIX + windowId, JSON.stringify(sizes))
}

export function loadZoneSizes(windowId: string): PersistedZoneSizes | null {
  try {
    const raw = localStorage.getItem(ZONE_SIZES_PREFIX + windowId)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
