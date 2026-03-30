import { app, window as neuWindow, events } from '@neutralinojs/lib'

let neutralinoActive = false

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

export function createWindow(id: string): void {
  if (isNeutralino()) {
    const url = import.meta.env.DEV
      ? `http://localhost:5173/?window=${id}`
      : `/?window=${id}`
    neuWindow.create(url, {
      title: 'Cotect',
      width: 800,
      height: 600,
      minWidth: 400,
      minHeight: 300,
      center: true,
      exitProcessOnClose: false,
      injectGlobals: true,
    }).catch((err) => {
      console.error('Failed to create window:', err)
    })
  } else {
    window.open(`${window.location.origin}/?window=${id}`, '_blank')
  }
}

export function setWindowSizeConstraints(minWidth: number, minHeight: number): void {
  if (isNeutralino()) {
    neuWindow.setSize({ minWidth, minHeight }).catch(() => {})
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
