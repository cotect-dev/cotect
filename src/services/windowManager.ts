import { filesystem } from '@neutralinojs/lib'
import { isNeutralino } from './platform'
import type { PanelPosition } from '@/store/layout'

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
