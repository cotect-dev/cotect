import { readJson, writeJsonSync, removeSync } from './storage'

const PREFIX = 'panel-'

export async function loadPanelState<T = unknown>(panelId: string): Promise<T | null> {
  return readJson<T>(`${PREFIX}${panelId}`)
}

export function savePanelState(panelId: string, state: unknown): void {
  writeJsonSync(`${PREFIX}${panelId}`, state)
}

export function clearPanelState(panelId: string): void {
  removeSync(`${PREFIX}${panelId}`)
}
