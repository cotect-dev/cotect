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

export interface Platform {
  isWayland(): Promise<boolean>

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
    writeFile(path: string, content: string): Promise<void>
    readDirectory(path: string): Promise<FSEntry[]>
    showFolderDialog(title: string): Promise<string | null>
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
}
