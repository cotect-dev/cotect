import { WebviewWindow, getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { Store } from '@tauri-apps/plugin-store'
import { open } from '@tauri-apps/plugin-dialog'
import type { Platform, FSEntry, CursorWindowInfo, WindowMonitorInfo, MonitorInfo } from './types'

let store: Store | null = null

async function getStore(): Promise<Store> {
  if (!store) {
    store = await Store.load('app-state.json', { defaults: {}, autoSave: true })
  }
  return store
}

function getWindowId(): string {
  const params = new URLSearchParams(window.location.search)
  return params.get('window') ?? 'main'
}

const currentWindow = getCurrentWebviewWindow()

let _isWayland: boolean | null = null

export const tauriPlatform: Platform = {
  async isWayland() {
    if (_isWayland === null) {
      _isWayland = await invoke<boolean>('is_wayland')
    }
    return _isWayland
  },

  windows: {
    getWindowId,

    async create(id, opts) {
      const url = `/?window=${id}`
      const webview = new WebviewWindow(id, {
        url,
        title: opts?.title ?? 'Cotect',
        width: opts?.width ?? 800,
        height: opts?.height ?? 600,
        minWidth: opts?.minWidth ?? 400,
        minHeight: opts?.minHeight ?? 300,
        x: opts?.x,
        y: opts?.y,
        center: opts?.center ?? (!opts?.x && !opts?.y),
        visible: opts?.visible ?? true,
      })
      await new Promise<void>((resolve, reject) => {
        webview.once('tauri://created', () => resolve())
        webview.once('tauri://error', (e) => reject(new Error(String(e.payload))))
      })
    },

    async getPosition() {
      const pos = await currentWindow.outerPosition()
      return { x: pos.x, y: pos.y }
    },

    async getSize() {
      const size = await currentWindow.outerSize()
      return { width: size.width, height: size.height }
    },

    async move(x, y) {
      const { PhysicalPosition } = await import('@tauri-apps/api/dpi')
      await currentWindow.setPosition(new PhysicalPosition(x, y))
    },

    async resize(width, height) {
      const { PhysicalSize } = await import('@tauri-apps/api/dpi')
      await currentWindow.setSize(new PhysicalSize(width, height))
    },

    async setMinSize(width, height) {
      const { PhysicalSize } = await import('@tauri-apps/api/dpi')
      await currentWindow.setMinSize(new PhysicalSize(width, height))
    },

    async maximize() {
      await currentWindow.maximize()
    },

    async isMaximized() {
      return currentWindow.isMaximized()
    },

    async getCursorWindow(): Promise<CursorWindowInfo | null> {
      return invoke<CursorWindowInfo | null>('get_cursor_window')
    },

    async getWindowMonitor(label: string): Promise<WindowMonitorInfo | null> {
      return invoke<WindowMonitorInfo | null>('get_window_monitor', { label })
    },

    async setWindowOnMonitor(label: string, monitorIndex: number): Promise<boolean> {
      return invoke<boolean>('set_window_on_monitor', { label, monitorIndex })
    },

    async getMonitors(): Promise<MonitorInfo[]> {
      return invoke<MonitorInfo[]>('get_monitors')
    },

    async onMoved(callback) {
      return currentWindow.onMoved(({ payload }) => {
        callback({ x: payload.x, y: payload.y })
      })
    },

    async onResized(callback) {
      return currentWindow.onResized(({ payload }) => {
        callback({ width: payload.width, height: payload.height })
      })
    },

    async show() {
      await currentWindow.show()
    },

    async close() {
      await currentWindow.close()
    },

    async closeAll() {
      await emit('app-close-all', {})
    },

    onClose(callback) {
      const handler = () => { callback() }
      window.addEventListener('beforeunload', handler)
      return () => {
        window.removeEventListener('beforeunload', handler)
      }
    },
  },

  ipc: {
    async emit(event, payload) {
      await emit(event, payload)
    },

    listen(event, callback) {
      let unlisten: UnlistenFn | null = null
      listen(event, (e) => {
        callback(e.payload)
      }).then((fn) => { unlisten = fn })

      return () => { unlisten?.() }
    },
  },

  fs: {
    async readFile(path: string): Promise<string> {
      return invoke<string>('read_file_content', { filePath: path })
    },

    async readFileHead(path: string, maxBytes: number): Promise<{ content: string; totalBytes: number }> {
      const result = await invoke<{ content: string; total_bytes: number }>('read_file_head', { filePath: path, maxBytes })
      return { content: result.content, totalBytes: result.total_bytes }
    },

    async readBinaryFile(path: string): Promise<Uint8Array> {
      const arr = await invoke<number[]>('read_binary_file', { filePath: path })
      return new Uint8Array(arr)
    },

    async writeFile(path: string, content: string): Promise<void> {
      const { writeTextFile } = await import('@tauri-apps/plugin-fs')
      await writeTextFile(path, content)
    },

    async readDirectory(path: string): Promise<FSEntry[]> {
      const entries = await invoke<Array<{ name: string; path: string; is_directory: boolean }>>('read_directory', { dirPath: path })
      return entries.map((e) => ({
        name: e.name,
        path: e.path,
        isDirectory: e.is_directory,
      }))
    },

    async showFolderDialog(title: string): Promise<string | null> {
      const result = await open({ title, directory: true })
      return result as string | null
    },

    async showInFolder(path: string): Promise<void> {
      await invoke('show_in_folder', { path })
    },
  },

  storage: {
    async get<T>(key: string): Promise<T | null> {
      try {
        const s = await getStore()
        const value = await s.get<T>(key)
        return value ?? null
      } catch {
        return null
      }
    },

    async set<T>(key: string, value: T) {
      const s = await getStore()
      await s.set(key, value)
    },

    setSync<T>(key: string, value: T) {
      getStore().then((s) => s.set(key, value)).catch(() => {})
    },

    async remove(key: string) {
      const s = await getStore()
      await s.delete(key)
    },

    removeSync(key: string) {
      getStore().then((s) => s.delete(key)).catch(() => {})
    },

    async exists(key: string) {
      const s = await getStore()
      return s.has(key)
    },

    async listKeys(prefix: string) {
      const s = await getStore()
      const allKeys = await s.keys()
      return allKeys.filter((k) => k.startsWith(prefix))
    },
  },

  syncedState: {
    set(name: string, state: unknown, windowId: string) {
      invoke('set_synced_state', { name, state, source: windowId }).catch(() => {})
    },

    async get(name: string): Promise<unknown | null> {
      return invoke('get_synced_state', { name })
    },

    async clear(name: string): Promise<void> {
      await invoke('clear_synced_state', { name })
    },

    listen(name: string, callback: (payload: { state: unknown; source: string }) => void): () => void {
      let unlisten: UnlistenFn | null = null
      listen(`synced-state-update:${name}`, (e) => {
        callback(e.payload as { state: unknown; source: string })
      }).then((fn) => { unlisten = fn })
      return () => { unlisten?.() }
    },
  },
}
