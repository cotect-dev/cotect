import { app, os, window as neuWindow, events } from '@neutralinojs/lib'
import type { PersistedGeometry } from '@/services/windowManager'

let neutralinoActive = false
const childPids: number[] = []

export function setNeutralinoActive(active: boolean): void {
  neutralinoActive = active
}

export function isNeutralino(): boolean {
  return neutralinoActive
}

export function getWindowId(): string {
  const params = new URLSearchParams(window.location.search)
  return params.get('window') ?? 'main'
}

export function createWindow(id: string, geometry?: PersistedGeometry | null): void {
  if (isNeutralino()) {
    const url = import.meta.env.DEV
      ? `http://localhost:5173/?window=${id}`
      : `/?window=${id}`

    const options: Record<string, unknown> = {
      title: 'Cotect',
      width: geometry?.width ?? 800,
      height: geometry?.height ?? 600,
      minWidth: 400,
      minHeight: 300,
      exitProcessOnClose: false,
      injectGlobals: true,
    }

    if (geometry) {
      options.x = geometry.x
      options.y = geometry.y
    } else {
      options.center = true
    }

    ;(neuWindow.create(url, options as Parameters<typeof neuWindow.create>[1]) as Promise<{ pid?: number }>).then((result) => {
      if (result?.pid) childPids.push(result.pid)
    }).catch((err) => {
      console.error('Failed to create window:', err)
    })
  } else {
    window.open(`${window.location.origin}/?window=${id}`, '_blank')
  }
}

export function showWindow(): void {
  if (isNeutralino()) {
    neuWindow.show().catch(() => {})
  }
}

export function setWindowSizeConstraints(minWidth: number, minHeight: number): void {
  if (isNeutralino()) {
    neuWindow.setSize({ minWidth, minHeight }).catch(() => {})
  }
}

export function killChildWindows(): void {
  if (isNeutralino()) {
    for (const pid of childPids) {
      os.execCommand(`kill ${pid}`).catch(() => {})
    }
    childPids.length = 0
  }
}

export function closeWindow(): void {
  if (isNeutralino()) {
    app.killProcess().catch(() => {
      app.exit().catch(() => window.close())
    })
  } else {
    window.close()
  }
}

export function onWindowClose(callback: () => void): () => void {
  if (isNeutralino()) {
    const handler = () => callback()
    events.on('windowClose', handler).catch(() => {})
    return () => { events.off('windowClose', handler).catch(() => {}) }
  } else {
    const handler = () => { callback() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }
}
