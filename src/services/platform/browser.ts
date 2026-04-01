import type { Platform, FSEntry, CursorWindowInfo, WindowMonitorInfo, MonitorInfo } from './types'

const LS_PREFIX = 'cotect:'

function lsKey(key: string): string {
  return `${LS_PREFIX}${key}`
}

function getWindowId(): string {
  const params = new URLSearchParams(window.location.search)
  return params.get('window') ?? 'main'
}

let bcChannel: BroadcastChannel | null = null

function getBcChannel(): BroadcastChannel {
  if (!bcChannel) {
    bcChannel = new BroadcastChannel('cotect')
  }
  return bcChannel
}

export const browserPlatform: Platform = {
  async isWayland() { return false },

  windows: {
    getWindowId,

    async create(id, opts) {
      const url = `${window.location.origin}/?window=${id}`
      const features = opts
        ? `width=${opts.width ?? 800},height=${opts.height ?? 600}`
        : undefined
      window.open(url, '_blank', features)
    },

    async getPosition() {
      return { x: window.screenX, y: window.screenY }
    },

    async getSize() {
      return { width: window.outerWidth, height: window.outerHeight }
    },

    async move(x, y) {
      window.moveTo(x, y)
    },

    async resize(width, height) {
      window.resizeTo(width, height)
    },

    async setMinSize() {},

    async maximize() {},

    async isMaximized() {
      return false
    },

    async getCursorWindow(): Promise<CursorWindowInfo | null> {
      return null
    },

    async getWindowMonitor(): Promise<WindowMonitorInfo | null> {
      return null
    },

    async setWindowOnMonitor(): Promise<boolean> {
      return false
    },

    async getMonitors(): Promise<MonitorInfo[]> {
      return []
    },

    async onMoved(_callback) {
      return () => {}
    },

    async onResized(callback) {
      const handler = () => { callback({ width: window.outerWidth, height: window.outerHeight }) }
      window.addEventListener('resize', handler)
      return () => window.removeEventListener('resize', handler)
    },

    async show() {},

    async close() {
      window.close()
    },

    async closeAll() {
      window.close()
    },

    onClose(callback) {
      const handler = () => { callback() }
      window.addEventListener('beforeunload', handler)
      return () => window.removeEventListener('beforeunload', handler)
    },
  },

  ipc: {
    async emit(event, payload) {
      getBcChannel().postMessage({ event, payload })
    },

    listen(event, callback) {
      const handler = (e: MessageEvent) => {
        if (e.data?.event === event) {
          callback(e.data.payload)
        }
      }
      getBcChannel().addEventListener('message', handler)
      return () => getBcChannel().removeEventListener('message', handler)
    },
  },

  fs: {
    async readFile() {
      throw new Error('Filesystem not available in browser')
    },

    async writeFile() {
      throw new Error('Filesystem not available in browser')
    },

    async readDirectory(): Promise<FSEntry[]> {
      throw new Error('Filesystem not available in browser')
    },

    async showFolderDialog() {
      return null
    },
  },

  storage: {
    async get<T>(key: string): Promise<T | null> {
      try {
        const raw = localStorage.getItem(lsKey(key))
        return raw ? (JSON.parse(raw) as T) : null
      } catch {
        return null
      }
    },

    async set<T>(key: string, value: T) {
      localStorage.setItem(lsKey(key), JSON.stringify(value))
    },

    setSync<T>(key: string, value: T) {
      localStorage.setItem(lsKey(key), JSON.stringify(value))
    },

    async remove(key: string) {
      localStorage.removeItem(lsKey(key))
    },

    removeSync(key: string) {
      localStorage.removeItem(lsKey(key))
    },

    async exists(key: string) {
      return localStorage.getItem(lsKey(key)) !== null
    },

    async listKeys(prefix: string) {
      const lsPrefix = lsKey(prefix)
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith(lsPrefix)) {
          keys.push(k.slice(LS_PREFIX.length))
        }
      }
      return keys
    },
  },
}
