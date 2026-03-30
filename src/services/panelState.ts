import { filesystem } from '@neutralinojs/lib'
import { isNeutralino } from './platform'

const FILE_PREFIX = '/tmp/cotect-panel-'
const LS_PREFIX = 'cotect:panel:'

export async function loadPanelState<T = unknown>(panelId: string): Promise<T | null> {
  if (isNeutralino()) {
    try {
      const raw = await filesystem.readFile(`${FILE_PREFIX}${panelId}.json`)
      return JSON.parse(raw)
    } catch {
      return null
    }
  } else {
    try {
      const raw = localStorage.getItem(`${LS_PREFIX}${panelId}`)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }
}

export function savePanelState(panelId: string, state: unknown): void {
  const json = JSON.stringify(state)
  if (isNeutralino()) {
    filesystem.writeFile(`${FILE_PREFIX}${panelId}.json`, json).catch(() => {})
  } else {
    try { localStorage.setItem(`${LS_PREFIX}${panelId}`, json) } catch {}
  }
}

export function clearPanelState(panelId: string): void {
  if (isNeutralino()) {
    filesystem.remove(`${FILE_PREFIX}${panelId}.json`).catch(() => {})
  } else {
    try { localStorage.removeItem(`${LS_PREFIX}${panelId}`) } catch {}
  }
}
