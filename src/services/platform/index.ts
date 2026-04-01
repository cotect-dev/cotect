export type { Platform, WindowOptions, FSEntry } from './types'

import type { Platform } from './types'

let _platform: Platform | null = null

export function getPlatform(): Platform {
  if (!_platform) {
    throw new Error('Platform not initialized. Call initPlatform() first.')
  }
  return _platform
}

export async function initPlatform(): Promise<Platform> {
  if (_platform) return _platform

  if ('__TAURI_INTERNALS__' in window) {
    const { tauriPlatform } = await import('./tauri')
    _platform = tauriPlatform
  } else {
    const { browserPlatform } = await import('./browser')
    _platform = browserPlatform
  }

  return _platform
}
