export interface WindowOptions {
  title?: string
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  x?: number
  y?: number
  center?: boolean
  visible?: boolean
}

export interface FSEntry {
  name: string
  path: string
  isDirectory: boolean
}

export interface CursorWindowInfo {
  label: string
  x: number
  y: number
}

export interface WindowMonitorInfo {
  monitor_model: string | null
  monitor_manufacturer: string | null
  monitor_x: number
  monitor_y: number
  monitor_width: number
  monitor_height: number
  scale_factor: number
}

export interface MonitorInfo {
  index: number
  model: string | null
  manufacturer: string | null
  x: number
  y: number
  width: number
  height: number
  scale_factor: number
}

export interface AppInfo {
  version: string
  os: string
  arch: string
  /** Bundle build label shown alongside os/arch (e.g. "universal" on macOS); may be empty. */
  build: string
}

export interface Platform {
  isWayland(): Promise<boolean>

  app: {
    /** Version + platform/build info for the About settings section. */
    info(): Promise<AppInfo>
    /** Open an http(s) URL in the user's default browser. */
    openExternal(url: string): Promise<void>
  }

  windows: {
    getWindowId(): string
    create(id: string, opts?: WindowOptions): Promise<void>
    getPosition(): Promise<{ x: number; y: number }>
    getSize(): Promise<{ width: number; height: number }>
    move(x: number, y: number): Promise<void>
    resize(width: number, height: number): Promise<void>
    setMinSize(width: number, height: number): Promise<void>
    maximize(): Promise<void>
    isMaximized(): Promise<boolean>
    getCursorWindow(): Promise<CursorWindowInfo | null>
    getWindowMonitor(label: string): Promise<WindowMonitorInfo | null>
    setWindowOnMonitor(label: string, monitorIndex: number): Promise<boolean>
    getMonitors(): Promise<MonitorInfo[]>
    onMoved(callback: (position: { x: number; y: number }) => void): Promise<() => void>
    onResized(callback: (size: { width: number; height: number }) => void): Promise<() => void>
    show(): Promise<void>
    close(): Promise<void>
    closeAll(): Promise<void>
    onClose(callback: () => void): () => void
  }

  ipc: {
    emit(event: string, payload: unknown): Promise<void>
    listen(event: string, callback: (payload: unknown) => void): () => void
  }

  fs: {
    readFile(path: string): Promise<string>
    /** Read at most maxBytes from the start of a file.
     *  Returns the content (truncated at a UTF-8 boundary) and total file size. */
    readFileHead(path: string, maxBytes: number): Promise<{ content: string; totalBytes: number }>
    readBinaryFile(path: string): Promise<Uint8Array>
    writeFile(path: string, content: string): Promise<void>
    readDirectory(path: string): Promise<FSEntry[]>
    showFolderDialog(title: string): Promise<string | null>
    /** Open a path in the system file manager. If path is a file, opens the parent directory. */
    showInFolder(path: string): Promise<void>
  }

  storage: {
    get<T>(key: string): Promise<T | null>
    set<T>(key: string, value: T): Promise<void>
    setSync<T>(key: string, value: T): void
    remove(key: string): Promise<void>
    removeSync(key: string): void
    exists(key: string): Promise<boolean>
    listKeys(prefix: string): Promise<string[]>
  }

  syncedState: {
    /** Push state update to the backend. */
    set(name: string, state: unknown, windowId: string): void
    /** Get current state from the backend. */
    get(name: string): Promise<unknown | null>
    /** Clear a store's state in the backend (used on fresh start). */
    clear(name: string): Promise<void>
    /** Listen for state updates broadcast by the backend. */
    listen(
      name: string,
      callback: (payload: { state: unknown; source: string }) => void,
    ): () => void
  }
}
