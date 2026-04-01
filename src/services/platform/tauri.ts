import { WebviewWindow, getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { Store } from '@tauri-apps/plugin-store'
import { open } from '@tauri-apps/plugin-dialog'
import type { Platform, FSEntry } from './types'

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

export const tauriPlatform: Platform = {
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
      const pos = await getCurrentWebviewWindow().outerPosition()
      return { x: pos.x, y: pos.y }
    },

    async getSize() {
      const size = await getCurrentWebviewWindow().outerSize()
      return { width: size.width, height: size.height }
    },

    async move(x, y) {
      const { PhysicalPosition } = await import('@tauri-apps/api/dpi')
      await getCurrentWebviewWindow().setPosition(new PhysicalPosition(x, y))
    },

    async resize(width, height) {
      const { PhysicalSize } = await import('@tauri-apps/api/dpi')
      await getCurrentWebviewWindow().setSize(new PhysicalSize(width, height))
    },

    async setMinSize(width, height) {
      const { PhysicalSize } = await import('@tauri-apps/api/dpi')
      await getCurrentWebviewWindow().setMinSize(new PhysicalSize(width, height))
    },

    async maximize() {
      await getCurrentWebviewWindow().maximize()
    },

    async isMaximized() {
      return getCurrentWebviewWindow().isMaximized()
    },

    async show() {
      await getCurrentWebviewWindow().show()
    },

    async close() {
      await getCurrentWebviewWindow().close()
    },

    async closeAll() {
      await emit('app-close-all', {})
      await getCurrentWebviewWindow().close()
    },

    onClose(callback) {
      let unlisten: UnlistenFn | null = null
      getCurrentWebviewWindow().onCloseRequested(async () => {
        callback()
      }).then((fn) => { unlisten = fn })

      let unlistenAll: UnlistenFn | null = null
      listen('app-close-all', () => {
        callback()
      }).then((fn) => { unlistenAll = fn })

      return () => {
        unlisten?.()
        unlistenAll?.()
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
}
