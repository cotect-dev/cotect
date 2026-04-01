# Neutralino to Tauri v2 Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Neutralino with Tauri v2, introducing a platform abstraction layer that keeps the React app runnable in both desktop and browser environments.

**Architecture:** A `Platform` interface with four capabilities (windows, ipc, fs, storage) sits between the React app and the native runtime. Tauri implementation uses `@tauri-apps/api` for windows/events and `tauri-plugin-store` for persistence. Browser implementation uses `BroadcastChannel`, `localStorage`, and `window.open()`. All 9 Neutralino-dependent files are refactored to consume the platform interface.

**Tech Stack:** Tauri v2, Rust (thin backend), React 19, Vite 7, TypeScript 5.9, Zustand 5, dnd-kit

**Spec:** `docs/superpowers/specs/2026-04-01-neutralino-to-tauri-migration-design.md`

---

## File Structure

### New files
- `src/services/platform/types.ts` — Platform interface + shared types
- `src/services/platform/tauri.ts` — Tauri implementation of Platform
- `src/services/platform/browser.ts` — Browser implementation of Platform
- `src/services/platform/index.ts` — Runtime detection, re-exports
- `src-tauri/Cargo.toml` — Rust dependencies
- `src-tauri/tauri.conf.json` — Tauri window config, permissions
- `src-tauri/capabilities/default.json` — Tauri v2 permission grants
- `src-tauri/src/main.rs` — Rust entry point, plugin registration
- `src-tauri/src/commands.rs` — Custom Tauri commands (readDirectory, readFile, showFolderDialog)

### Modified files
- `package.json` — Replace Neutralino deps with Tauri deps, update scripts
- `vite.config.ts` — Remove Neutralino globals plugin
- `src/main.tsx` — Remove Neutralino init, use platform detection
- `src/services/windowManager.ts` — Use `platform.windows` and `platform.storage`
- `src/store/synced.ts` — IPC-based cross-window sync
- `src/store/layout.ts` — Use platform storage instead of direct windowManager import
- `src/store/browser.ts` — Use platform.fs instead of direct filesystem import
- `src/hooks/useWindowLifecycle.ts` — Use platform APIs
- `src/components/Layout/usePanelDrag.ts` — Use platform.ipc instead of channel
- `src/components/Layout/CrossWindowDropOverlay.tsx` — Use platform.ipc instead of channel/polling
- `src/components/Layout/TopBar.tsx` — Use platform APIs for folder dialog and window creation
- `src/components/Layout/index.tsx` — Use platform.getWindowId()

### Deleted files
- `src/services/platform.ts` — Replaced by `platform/` directory
- `src/services/channel.ts` — Replaced by `platform.ipc`
- `src/services/storage.ts` — Replaced by `platform.storage`
- `src/services/filesystem.ts` — Replaced by `platform.fs`
- `src/services/windowPosition.ts` — Tauri handles decoration-aware positioning
- `neutralino.config.json` — Replaced by `src-tauri/tauri.conf.json`
- `scripts/neu-dev.js` — Replaced by `tauri dev`

---

## Task 1: Initialize Tauri project structure

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/commands.rs`
- Modify: `package.json`
- Modify: `vite.config.ts`

- [ ] **Step 1: Install Tauri CLI and create the Rust backend**

Run:
```bash
cd /home/grzracz/dev/cotect
yarn add @tauri-apps/api @tauri-apps/plugin-store @tauri-apps/plugin-dialog @tauri-apps/plugin-fs
yarn add -D @tauri-apps/cli
```

- [ ] **Step 2: Create `src-tauri/Cargo.toml`**

```toml
[package]
name = "cotect"
version = "0.0.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["multiwebview"] }
tauri-plugin-store = "2"
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 3: Create `src-tauri/src/main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::read_directory,
            commands::read_file_content,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Create `src-tauri/src/commands.rs`**

```rust
use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Serialize)]
pub struct FSEntry {
    name: String,
    path: String,
    is_directory: bool,
}

#[tauri::command]
pub fn read_directory(dir_path: String) -> Result<Vec<FSEntry>, String> {
    let path = Path::new(&dir_path);
    let mut entries: Vec<FSEntry> = fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name == "." || name == ".." {
                return None;
            }
            let is_directory = entry.file_type().ok()?.is_dir();
            Some(FSEntry {
                path: entry.path().to_string_lossy().to_string(),
                name,
                is_directory,
            })
        })
        .collect();

    entries.sort_by(|a, b| {
        if a.is_directory != b.is_directory {
            if a.is_directory { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater }
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(entries)
}

#[tauri::command]
pub fn read_file_content(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path).map_err(|e| e.to_string())
}
```

- [ ] **Step 5: Create `src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://raw.githubusercontent.com/nicedoc/tauri-schema/main/schema/2.0/tauri.conf.json",
  "productName": "Cotect",
  "version": "0.0.0",
  "identifier": "com.cotect.app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "yarn vite:dev",
    "beforeBuildCommand": "yarn vite:build"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "title": "Cotect",
        "width": 1280,
        "height": 720,
        "minWidth": 1280,
        "minHeight": 720,
        "visible": false,
        "center": true
      }
    ]
  }
}
```

- [ ] **Step 6: Create `src-tauri/capabilities/default.json`**

```json
{
  "identifier": "default",
  "description": "Default permissions for Cotect",
  "windows": ["*"],
  "permissions": [
    "core:default",
    "core:window:default",
    "core:window:allow-create",
    "core:window:allow-close",
    "core:window:allow-set-size",
    "core:window:allow-set-position",
    "core:window:allow-outer-position",
    "core:window:allow-outer-size",
    "core:window:allow-inner-size",
    "core:window:allow-is-maximized",
    "core:window:allow-maximize",
    "core:window:allow-show",
    "core:window:allow-center",
    "core:window:allow-set-min-size",
    "core:webview:default",
    "core:webview:allow-create-webview-window",
    "core:event:default",
    "core:event:allow-emit-to",
    "core:event:allow-listen",
    "store:default",
    "dialog:default",
    "dialog:allow-open",
    "fs:default",
    "fs:allow-read-text-file",
    "fs:allow-write-text-file",
    "fs:allow-exists",
    "fs:allow-read-dir"
  ]
}
```

- [ ] **Step 7: Create `src-tauri/build.rs`**

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 8: Update `package.json` scripts and dependencies**

Remove `@neutralinojs/lib` from dependencies, `@neutralinojs/neu` and `concurrently` from devDependencies. Update scripts:

```json
{
  "scripts": {
    "dev": "tauri dev",
    "build": "tauri build",
    "lint": "eslint .",
    "vite:dev": "vite",
    "vite:build": "tsc -b && vite build",
    "vite:preview": "vite preview"
  }
}
```

- [ ] **Step 9: Update `vite.config.ts` — remove Neutralino globals plugin**

Replace the entire file with:

```typescript
import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Prevent Vite from obscuring Rust errors
  clearScreen: false,
  server: {
    // Tauri expects a fixed port
    strictPort: true,
    proxy: {
      '/llm': {
        target: 'http://server:1234',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/llm/, ''),
      },
    },
  },
})
```

- [ ] **Step 10: Delete Neutralino files**

```bash
rm /home/grzracz/dev/cotect/neutralino.config.json
rm /home/grzracz/dev/cotect/scripts/neu-dev.js
```

- [ ] **Step 11: Commit**

```bash
git add src-tauri/ package.json vite.config.ts
git rm neutralino.config.json scripts/neu-dev.js
git commit -m "feat: initialize Tauri v2 project structure, remove Neutralino config"
```

---

## Task 2: Create platform abstraction layer — types and browser implementation

**Files:**
- Create: `src/services/platform/types.ts`
- Create: `src/services/platform/browser.ts`
- Create: `src/services/platform/index.ts`

- [ ] **Step 1: Create `src/services/platform/types.ts`**

```typescript
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

export interface Platform {
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
```

- [ ] **Step 2: Create `src/services/platform/browser.ts`**

```typescript
import type { Platform, FSEntry } from './types'

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

    async setMinSize() {
      // Not supported in browser
    },

    async maximize() {
      // Not supported in browser
    },

    async isMaximized() {
      return false
    },

    async show() {
      // Window is already visible in browser
    },

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
```

- [ ] **Step 3: Create `src/services/platform/index.ts`**

```typescript
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
```

- [ ] **Step 4: Commit**

```bash
git add src/services/platform/
git commit -m "feat: add platform abstraction layer with types and browser implementation"
```

---

## Task 3: Create Tauri platform implementation

**Files:**
- Create: `src/services/platform/tauri.ts`

- [ ] **Step 1: Create `src/services/platform/tauri.ts`**

```typescript
import { WebviewWindow, getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { Store } from '@tauri-apps/plugin-store'
import { open } from '@tauri-apps/plugin-dialog'
import type { Platform, FSEntry } from './types'

let store: Store | null = null

async function getStore(): Promise<Store> {
  if (!store) {
    store = await Store.load('app-state.json', { autoSave: true })
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
      // Wait for window to be created
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
      // Emit a close-all event so child windows can clean up
      await emit('app-close-all', {})
      await getCurrentWebviewWindow().close()
    },

    onClose(callback) {
      let unlisten: UnlistenFn | null = null
      getCurrentWebviewWindow().onCloseRequested(async () => {
        callback()
      }).then((fn) => { unlisten = fn })

      // Also listen for close-all from main window
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
```

- [ ] **Step 2: Commit**

```bash
git add src/services/platform/tauri.ts
git commit -m "feat: add Tauri platform implementation"
```

---

## Task 4: Migrate windowManager to platform abstraction

**Files:**
- Modify: `src/services/windowManager.ts`

- [ ] **Step 1: Rewrite `src/services/windowManager.ts`**

Replace the entire file. This removes all direct Neutralino and storage imports, using `getPlatform()` instead:

```typescript
import { getPlatform } from '@/services/platform'
import type { PanelPosition } from '@/store/layout'
import { useBrowserStore } from '@/store/browser'

export interface PersistedLayout {
  panels: Record<PanelPosition, string[][]>
  sizes: Record<PanelPosition, number[]>
  activeTab: Record<string, number>
}

export interface PersistedZoneSizes {
  left: number
  right: number
  bottom: number
}

export interface PersistedGeometry {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

export interface PersistedSession {
  rootPath: string
  currentPath: string
  viewMode: 'directory' | 'file'
}

// --- Window discovery ---

export async function getChildWindowIds(): Promise<string[]> {
  const platform = getPlatform()
  const keys = await platform.storage.listKeys('wm-layout-')
  return keys
    .map((k) => k.slice('wm-layout-'.length))
    .filter((id) => id !== 'main')
}

// --- Layout persistence ---

export function saveLayout(windowId: string, layout: PersistedLayout): void {
  getPlatform().storage.setSync(`wm-layout-${windowId}`, layout)
}

export async function loadLayout(windowId: string): Promise<PersistedLayout | null> {
  return getPlatform().storage.get<PersistedLayout>(`wm-layout-${windowId}`)
}

export function removeLayout(windowId: string): void {
  const platform = getPlatform()
  platform.storage.removeSync(`wm-layout-${windowId}`)
  platform.storage.removeSync(`wm-zones-${windowId}`)
  platform.storage.removeSync(`wm-geometry-${windowId}`)
}

// --- Zone sizes ---

export function saveZoneSizes(windowId: string, sizes: PersistedZoneSizes): void {
  getPlatform().storage.setSync(`wm-zones-${windowId}`, sizes)
}

export async function loadZoneSizes(windowId: string): Promise<PersistedZoneSizes | null> {
  return getPlatform().storage.get<PersistedZoneSizes>(`wm-zones-${windowId}`)
}

// --- Geometry ---

export function saveGeometry(windowId: string, geometry: PersistedGeometry): void {
  getPlatform().storage.setSync(`wm-geometry-${windowId}`, geometry)
}

export async function loadGeometry(windowId: string): Promise<PersistedGeometry | null> {
  return getPlatform().storage.get<PersistedGeometry>(`wm-geometry-${windowId}`)
}

// --- Session ---

export function saveSession(session: PersistedSession): void {
  getPlatform().storage.setSync('wm-session-main', session)
}

export async function loadSession(): Promise<PersistedSession | null> {
  return getPlatform().storage.get<PersistedSession>('wm-session-main')
}

// --- Polling persisters ---

interface Persister {
  start(): void
  stop(): void
}

function createPollingPersister(intervalMs: number, pollFn: () => Promise<void>): Persister {
  let timer: ReturnType<typeof setInterval> | null = null
  return {
    start() {
      if (timer) return
      timer = setInterval(() => { pollFn().catch(() => {}) }, intervalMs)
    },
    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
  }
}

let geometryPersister: Persister | null = null

export function startGeometryPersistence(windowId: string): void {
  geometryPersister?.stop()

  let lastJson = ''
  geometryPersister = createPollingPersister(2000, async () => {
    const platform = getPlatform()
    const pos = await platform.windows.getPosition()
    const size = await platform.windows.getSize()
    const maximized = await platform.windows.isMaximized()

    const geometry: PersistedGeometry = {
      x: pos.x,
      y: pos.y,
      width: size.width,
      height: size.height,
      isMaximized: maximized,
    }
    const json = JSON.stringify(geometry)
    if (json !== lastJson) {
      lastJson = json
      saveGeometry(windowId, geometry)
    }
  })
  geometryPersister.start()
}

export function stopGeometryPersistence(): void {
  geometryPersister?.stop()
  geometryPersister = null
}

let sessionPersister: (() => void) | null = null

export function startSessionPersistence(): void {
  sessionPersister?.()
  let timer: ReturnType<typeof setTimeout> | null = null
  sessionPersister = useBrowserStore.subscribe((state) => {
    if (!state.rootPath) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      saveSession({
        rootPath: state.rootPath,
        currentPath: state.currentPath,
        viewMode: state.viewMode,
      })
    }, 300)
  })
}

export function stopSessionPersistence(): void {
  sessionPersister?.()
  sessionPersister = null
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/windowManager.ts
git commit -m "refactor: migrate windowManager to platform abstraction"
```

---

## Task 5: Migrate synced stores to IPC-based sync

**Files:**
- Modify: `src/store/synced.ts`

- [ ] **Step 1: Rewrite `src/store/synced.ts`**

Replace the entire file. This uses platform IPC for live cross-window sync and platform storage for persistence:

```typescript
import { create, type StateCreator, type StoreApi } from 'zustand'
import { getPlatform } from '@/services/platform'

function computeSerializableKeys(state: Record<string, unknown>): Set<string> {
  const keys = new Set<string>()
  for (const [key, value] of Object.entries(state)) {
    if (typeof value !== 'function') keys.add(key)
  }
  return keys
}

function pickKeys<T>(state: T, keys: Set<string>): Partial<T> {
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    result[key] = (state as Record<string, unknown>)[key]
  }
  return result as Partial<T>
}

interface PendingEntry {
  name: string
  store: StoreApi<unknown>
  serializableKeys: Set<string>
  sanitize?: (s: Partial<unknown>) => Partial<unknown>
}

const pending: PendingEntry[] = []

interface SyncOptions<T> {
  sanitize?: (saved: Partial<T>) => Partial<T>
}

const STORAGE_PREFIX = 'panel-'

export function createSyncedStore<T>(name: string, creator: StateCreator<T>, options?: SyncOptions<T>) {
  const store = create<T>(creator)
  const serializableKeys = computeSerializableKeys(store.getState() as Record<string, unknown>)
  pending.push({
    name,
    store: store as unknown as StoreApi<unknown>,
    serializableKeys,
    sanitize: options?.sanitize as ((s: Partial<unknown>) => Partial<unknown>) | undefined,
  })
  return store
}

let unlisteners: (() => void)[] = []
let isSyncing = false

export function initAllSyncedStores(): void {
  const platform = getPlatform()
  const windowId = platform.windows.getWindowId()

  for (const entry of pending) {
    // Persist to storage on change (debounced)
    let timer: ReturnType<typeof setTimeout> | null = null
    entry.store.subscribe(() => {
      if (isSyncing) return // Don't re-broadcast changes from IPC sync
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const data = pickKeys(entry.store.getState(), entry.serializableKeys)
        platform.storage.setSync(`${STORAGE_PREFIX}${entry.name}`, data)
        // Broadcast to other windows
        platform.ipc.emit(`store-sync:${entry.name}`, { state: data, source: windowId }).catch(() => {})
      }, 300)
    })

    // Listen for sync events from other windows
    const unlisten = platform.ipc.listen(`store-sync:${entry.name}`, (payload: unknown) => {
      const { state, source } = payload as { state: Partial<unknown>; source: string }
      if (source !== windowId && state) {
        isSyncing = true
        entry.store.setState(entry.sanitize ? entry.sanitize(state) : state)
        isSyncing = false
      }
    })
    unlisteners.push(unlisten)
  }
}

export function clearAllSyncedStores(): void {
  const platform = getPlatform()
  for (const { name } of pending) {
    platform.storage.removeSync(`${STORAGE_PREFIX}${name}`)
  }
}

export function stopAllSyncedStores(): void {
  for (const unlisten of unlisteners) {
    unlisten()
  }
  unlisteners = []
}

export async function reloadSyncedStore(name: string): Promise<void> {
  const platform = getPlatform()
  const entry = pending.find((p) => p.name === name)
  if (!entry) return
  const saved = await platform.storage.get<Partial<unknown>>(`${STORAGE_PREFIX}${name}`)
  if (saved && typeof saved === 'object') {
    isSyncing = true
    entry.store.setState(entry.sanitize ? entry.sanitize(saved) : saved)
    isSyncing = false
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/store/synced.ts
git commit -m "refactor: migrate synced stores to platform IPC-based sync"
```

---

## Task 6: Migrate browser store to platform fs

**Files:**
- Modify: `src/store/browser.ts:3`

- [ ] **Step 1: Update the import in `src/store/browser.ts`**

Replace:
```typescript
import { readDirectory, readFileContent, type FSEntry } from '@/services/filesystem'
```

With:
```typescript
import { getPlatform, type FSEntry } from '@/services/platform'
```

- [ ] **Step 2: Update usages of `readDirectory` and `readFileContent` in `src/store/browser.ts`**

Find all calls to `readDirectory(...)` and replace with `getPlatform().fs.readDirectory(...)`.
Find all calls to `readFileContent(...)` and replace with `getPlatform().fs.readFile(...)`.

For example, replace:
```typescript
const entries = await readDirectory(path)
```
with:
```typescript
const entries = await getPlatform().fs.readDirectory(path)
```

And replace:
```typescript
const content = await readFileContent(path)
```
with:
```typescript
const content = await getPlatform().fs.readFile(path)
```

- [ ] **Step 3: Commit**

```bash
git add src/store/browser.ts
git commit -m "refactor: migrate browser store to platform.fs"
```

---

## Task 7: Migrate useWindowLifecycle to platform APIs

**Files:**
- Modify: `src/hooks/useWindowLifecycle.ts`

- [ ] **Step 1: Rewrite `src/hooks/useWindowLifecycle.ts`**

Replace the entire file:

```typescript
import { useEffect, useState } from 'react'
import { getPlatform } from '@/services/platform'
import { loadLayout, loadGeometry, loadSession, getChildWindowIds, removeLayout, startGeometryPersistence, stopGeometryPersistence, startSessionPersistence, stopSessionPersistence } from '@/services/windowManager'
import { useBrowserStore } from '@/store/browser'
import { loadLayoutIntoStore, startLayoutPersistence, stopLayoutPersistence } from '@/store/layout'
import { initAllSyncedStores, clearAllSyncedStores, stopAllSyncedStores } from '@/store/synced'

const platform = getPlatform()
const windowId = platform.windows.getWindowId()
const isMain = windowId === 'main'

const DEFAULT_MAIN_LAYOUT = {
  panels: { left: [['explorer']], right: [['chat']], bottom: [['console']] },
  sizes: { left: [1], right: [1], bottom: [1] },
  activeTab: {},
}

export function useWindowLifecycle() {
  const [isReady, setIsReady] = useState(false)

  // One-time store init
  useEffect(() => {
    platform.windows.setMinSize(isMain ? 1280 : 400, isMain ? 720 : 300)
    if (isMain) clearAllSyncedStores()
    initAllSyncedStores()
    return () => { stopAllSyncedStores() }
  }, [])

  // Async state restoration
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const [saved, geo, childIds, session] = await Promise.all([
        loadLayout(windowId),
        loadGeometry(windowId),
        isMain ? getChildWindowIds() : [],
        isMain ? loadSession() : null,
      ])
      if (cancelled) return

      startGeometryPersistence(windowId)

      if (geo) {
        await platform.windows.move(geo.x, geo.y).catch(() => {})
        if (isMain) await platform.windows.resize(geo.width, geo.height).catch(() => {})
        if (geo.isMaximized) await platform.windows.maximize().catch(() => {})
      }

      loadLayoutIntoStore(saved ?? (isMain ? DEFAULT_MAIN_LAYOUT : { panels: { left: [], right: [], bottom: [] }, sizes: { left: [], right: [], bottom: [] }, activeTab: {} }))
      startLayoutPersistence(windowId)

      if (isMain) platform.windows.show()
      const splash = document.getElementById('splash')
      if (splash) {
        splash.classList.add('hide')
        setTimeout(() => splash.remove(), 200)
      }

      if (isMain) {
        if (childIds.length > 0) {
          const geometries = await Promise.all(childIds.map((id) => loadGeometry(id)))
          if (cancelled) return
          for (let i = 0; i < childIds.length; i++) {
            const geo = geometries[i]
            await platform.windows.create(childIds[i], geo ? {
              x: geo.x,
              y: geo.y,
              width: geo.width,
              height: geo.height,
            } : undefined).catch((err) => {
              console.error('Failed to create window:', err)
            })
          }
        }

        if (session?.rootPath) {
          try {
            await useBrowserStore.getState().openRoot(session.rootPath)
            if (cancelled) return
            if (session.currentPath && session.currentPath !== session.rootPath) {
              await useBrowserStore.getState().navigateTo(session.currentPath, session.viewMode)
            }
          } catch {
            // Root path no longer exists
          }
        }
        startSessionPersistence()
      }

      // Broadcast window-opened
      platform.ipc.emit('window-opened', { windowId }).catch(() => {})

      setIsReady(true)
    })()

    return () => { cancelled = true }
  }, [])

  // Child window: close when main closes
  useEffect(() => {
    if (isMain) return
    return platform.ipc.listen('window-closed', (payload: unknown) => {
      const { windowId: closedId } = payload as { windowId: string }
      if (closedId === 'main') platform.windows.close()
    })
  }, [])

  // Window close handler
  useEffect(() => {
    return platform.windows.onClose(() => {
      stopLayoutPersistence()
      stopGeometryPersistence()
      stopSessionPersistence()
      stopAllSyncedStores()
      if (!isMain) removeLayout(windowId)
      platform.ipc.emit('window-closed', { windowId }).catch(() => {})
      if (isMain) {
        platform.windows.closeAll()
      } else {
        platform.windows.close()
      }
    })
  }, [])

  // Cleanup persistence on unmount
  useEffect(() => {
    return () => {
      stopLayoutPersistence()
      stopGeometryPersistence()
      stopSessionPersistence()
    }
  }, [])

  return { isMain, isReady }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useWindowLifecycle.ts
git commit -m "refactor: migrate useWindowLifecycle to platform APIs"
```

---

## Task 8: Migrate usePanelDrag to platform IPC

**Files:**
- Modify: `src/components/Layout/usePanelDrag.ts`

- [ ] **Step 1: Update imports in `src/components/Layout/usePanelDrag.ts`**

Replace:
```typescript
import { broadcast } from '@/services/channel'
import { getWindowId } from '@/services/platform'
import { getWindowBounds } from '@/services/windowPosition'
```

With:
```typescript
import { getPlatform } from '@/services/platform'
```

- [ ] **Step 2: Add platform constants at top of `usePanelDrag` function**

After `const [dragState, setDragState] = useState<DragState | null>(null)`, add:

```typescript
const platform = getPlatform()
const windowId = platform.windows.getWindowId()
```

- [ ] **Step 3: Update `handleDragStart` — replace `broadcast` and `getWindowId`**

Replace:
```typescript
      void broadcast({
        type: 'drag-start',
        panelId: data.panelId,
        panelIds: data.isGroup ? data.panelIds : [data.panelId],
        sourceWindow: getWindowId(),
      })
```

With:
```typescript
      void platform.ipc.emit('drag-start', {
        panelId: data.panelId,
        panelIds: data.isGroup ? data.panelIds : [data.panelId],
        sourceWindow: windowId,
      })
```

- [ ] **Step 4: Update `handleDragMove` — replace `getWindowBounds` and `broadcast`**

Replace the bounds check block:
```typescript
      const bounds = getWindowBounds()
      wasDragOutside.current =
        screenX < bounds.left || screenX > bounds.right ||
        screenY < bounds.top || screenY > bounds.bottom
```

With an async bounds check using platform (get position and size once per throttle cycle). Since `handleDragMove` is synchronous, use cached window bounds. Add a ref for cached bounds at the top of the hook, near other refs:

```typescript
const windowBoundsRef = useRef({ left: 0, top: 0, right: 0, bottom: 0 })
```

Add an effect to keep bounds updated:

```typescript
useEffect(() => {
  const update = async () => {
    const pos = await platform.windows.getPosition()
    const size = await platform.windows.getSize()
    windowBoundsRef.current = {
      left: pos.x,
      top: pos.y,
      right: pos.x + size.width,
      bottom: pos.y + size.height,
    }
  }
  update()
  const timer = setInterval(update, 500)
  return () => clearInterval(timer)
}, [platform])
```

Then use the ref:
```typescript
      const bounds = windowBoundsRef.current
      wasDragOutside.current =
        screenX < bounds.left || screenX > bounds.right ||
        screenY < bounds.top || screenY > bounds.bottom
```

Replace the broadcast call:
```typescript
        void broadcast({
          type: 'drag-move',
          screenX,
          screenY,
          sourceWindow: getWindowId(),
        })
```

With:
```typescript
        void platform.ipc.emit('drag-move', {
          screenX,
          screenY,
          sourceWindow: windowId,
        })
```

- [ ] **Step 5: Update `handleDragEnd` — replace `broadcast` and `getWindowId`**

Replace:
```typescript
      void broadcast({ type: 'drag-end', sourceWindow: getWindowId() })
```

With:
```typescript
      void platform.ipc.emit('drag-end', { sourceWindow: windowId })
```

- [ ] **Step 6: Update `handleDragCancel` — same broadcast replacement**

Replace:
```typescript
    void broadcast({ type: 'drag-end', sourceWindow: getWindowId() })
```

With:
```typescript
    void platform.ipc.emit('drag-end', { sourceWindow: windowId })
```

- [ ] **Step 7: Commit**

```bash
git add src/components/Layout/usePanelDrag.ts
git commit -m "refactor: migrate usePanelDrag to platform IPC"
```

---

## Task 9: Migrate CrossWindowDropOverlay to platform IPC

**Files:**
- Modify: `src/components/Layout/CrossWindowDropOverlay.tsx`

- [ ] **Step 1: Rewrite `src/components/Layout/CrossWindowDropOverlay.tsx`**

Replace the entire file:

```typescript
import { useCallback, useEffect, useRef } from 'react'
import { getPlatform } from '@/services/platform'
import { useLayoutStore, type PanelPosition } from '@/store/layout'
import { reloadSyncedStore } from '@/store/synced'

type HoverZone = PanelPosition | null

interface Props {
  zoneRefs: React.RefObject<Record<PanelPosition, HTMLDivElement | null>>
  mode?: 'main' | 'panel'
}

export default function CrossWindowDropOverlay({ zoneRefs, mode = 'main' }: Props) {
  const platform = getPlatform()
  const windowId = platform.windows.getWindowId()
  const setCrossWindowDrag = useLayoutStore((s) => s.setCrossWindowDrag)
  const windowBoundsRef = useRef({ left: 0, top: 0, right: 0, bottom: 0 })

  // Keep window bounds updated
  useEffect(() => {
    const update = async () => {
      const pos = await platform.windows.getPosition()
      const size = await platform.windows.getSize()
      windowBoundsRef.current = {
        left: pos.x,
        top: pos.y,
        right: pos.x + size.width,
        bottom: pos.y + size.height,
      }
    }
    update()
    const timer = setInterval(update, 500)
    return () => clearInterval(timer)
  }, [platform])

  const detectZoneFromScreen = useCallback((screenX: number, screenY: number): { zone: HoverZone; isOver: boolean } => {
    const bounds = windowBoundsRef.current

    if (screenX < bounds.left || screenX > bounds.right || screenY < bounds.top || screenY > bounds.bottom) {
      return { zone: null, isOver: false }
    }

    const contentWidth = bounds.right - bounds.left
    const contentHeight = bounds.bottom - bounds.top
    const x = (screenX - bounds.left) / contentWidth
    const y = (screenY - bounds.top) / contentHeight

    let zone: HoverZone = null
    if (mode === 'panel') {
      zone = x < 0.5 ? 'left' : 'right'
    } else {
      if (y > 0.75) zone = 'bottom'
      else if (x < 0.25) zone = 'left'
      else if (x > 0.75) zone = 'right'
    }

    return { zone, isOver: true }
  }, [mode])

  const screenToClient = useCallback((screenX: number, screenY: number) => {
    const bounds = windowBoundsRef.current
    return {
      clientX: screenX - bounds.left,
      clientY: screenY - bounds.top,
    }
  }, [])

  const computeInsertFromScreen = useCallback((zone: PanelPosition, screenX: number, screenY: number): { insertIndex: number; neighborIndex: number } => {
    const el = zoneRefs.current[zone]
    if (!el) return { insertIndex: 0, neighborIndex: 0 }

    const rect = el.getBoundingClientRect()
    const isVertical = zone === 'left' || zone === 'right'

    const { clientX: localX, clientY: localY } = screenToClient(screenX, screenY)

    const sizes = useLayoutStore.getState().sizes[zone]
    if (sizes.length === 0) return { insertIndex: 0, neighborIndex: 0 }

    const totalSize = sizes.reduce((a, b) => a + b, 0)
    const relativePos = isVertical
      ? (localY - rect.top) / rect.height
      : (localX - rect.left) / rect.width

    let cumulative = 0
    for (let i = 0; i < sizes.length; i++) {
      const panelEnd = (cumulative + sizes[i]) / totalSize
      if (relativePos < panelEnd) {
        const panelMid = (cumulative + sizes[i] / 2) / totalSize
        if (relativePos < panelMid) {
          return { insertIndex: i, neighborIndex: i }
        } else {
          return { insertIndex: i + 1, neighborIndex: i }
        }
      }
      cumulative += sizes[i]
    }
    return { insertIndex: sizes.length, neighborIndex: sizes.length - 1 }
  }, [zoneRefs, screenToClient])

  useEffect(() => {
    let currentIncoming: { panelId: string; panelIds: string[]; sourceWindow: string } | null = null
    let currentZone: HoverZone = null
    let isOver = false
    let lastAccepted: { panelIds: string[] } | null = null

    const unlistenStart = platform.ipc.listen('drag-start', (payload: unknown) => {
      const msg = payload as { panelId: string; panelIds: string[]; sourceWindow: string }
      if (msg.sourceWindow !== windowId) {
        currentIncoming = { panelId: msg.panelId, panelIds: msg.panelIds, sourceWindow: msg.sourceWindow }
        lastAccepted = null
      }
    })

    const unlistenMove = platform.ipc.listen('drag-move', (payload: unknown) => {
      const msg = payload as { screenX: number; screenY: number; sourceWindow: string }
      if (msg.sourceWindow !== windowId && currentIncoming) {
        const result = detectZoneFromScreen(msg.screenX, msg.screenY)
        currentZone = result.zone
        isOver = result.isOver

        if (currentZone) {
          const { insertIndex, neighborIndex } = computeInsertFromScreen(currentZone, msg.screenX, msg.screenY)
          setCrossWindowDrag({
            panelId: currentIncoming.panelIds[0],
            panelIds: currentIncoming.panelIds,
            position: currentZone,
            insertIndex,
            neighborIndex,
          })
        } else {
          setCrossWindowDrag(null)
        }
      }
    })

    const unlistenEnd = platform.ipc.listen('drag-end', (payload: unknown) => {
      const msg = payload as { sourceWindow: string }
      if (msg.sourceWindow !== windowId) {
        if (currentIncoming && isOver && currentZone) {
          const cwd = useLayoutStore.getState().crossWindowDrag
          const insertIndex = cwd?.insertIndex ?? 0
          const neighborIndex = cwd?.neighborIndex ?? 0

          void platform.ipc.emit('drag-drop', {
            panelId: currentIncoming.panelId,
            panelIds: currentIncoming.panelIds,
            targetWindow: windowId,
            focusedAt: Date.now(),
            position: currentZone,
            groupKey: null,
          })

          const store = useLayoutStore.getState()
          for (const id of currentIncoming.panelIds) {
            store.removePanel(id)
          }
          store.moveGroup(currentIncoming.panelIds, currentZone, insertIndex, neighborIndex)
          for (const id of currentIncoming.panelIds) {
            reloadSyncedStore(id)
          }
          lastAccepted = { panelIds: [...currentIncoming.panelIds] }
        }

        currentIncoming = null
        currentZone = null
        isOver = false
        setCrossWindowDrag(null)
      }
    })

    const unlistenDrop = platform.ipc.listen('drag-drop', (payload: unknown) => {
      const msg = payload as { targetWindow: string }
      if (msg.targetWindow !== windowId && lastAccepted) {
        if (msg.targetWindow < windowId) {
          const store = useLayoutStore.getState()
          for (const id of lastAccepted.panelIds) {
            store.removePanel(id)
          }
        }
        lastAccepted = null
      }
    })

    return () => {
      unlistenStart()
      unlistenMove()
      unlistenEnd()
      unlistenDrop()
      setCrossWindowDrag(null)
    }
  }, [windowId, detectZoneFromScreen, computeInsertFromScreen, setCrossWindowDrag, platform])

  return null
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Layout/CrossWindowDropOverlay.tsx
git commit -m "refactor: migrate CrossWindowDropOverlay to platform IPC"
```

---

## Task 10: Migrate TopBar and Layout index

**Files:**
- Modify: `src/components/Layout/TopBar.tsx`
- Modify: `src/components/Layout/index.tsx`

- [ ] **Step 1: Update `src/components/Layout/TopBar.tsx`**

Replace imports:
```typescript
import { os } from '@neutralinojs/lib'
import { createWindow, closeWindow } from '@/services/platform'
import { broadcast } from '@/services/channel'
```

With:
```typescript
import { getPlatform } from '@/services/platform'
```

Replace the `handleOpenFolder` function:
```typescript
  const handleOpenFolder = async () => {
    try {
      const result = await os.showFolderDialog('Open Project Folder')
      if (result) {
        useBrowserStore.getState().openRoot(result)
      }
    } catch (err) {
      console.error('Failed to open folder dialog:', err)
    }
  }
```

With:
```typescript
  const platform = getPlatform()

  const handleOpenFolder = async () => {
    try {
      const result = await platform.fs.showFolderDialog('Open Project Folder')
      if (result) {
        useBrowserStore.getState().openRoot(result)
      }
    } catch (err) {
      console.error('Failed to open folder dialog:', err)
    }
  }
```

Replace `closeWindow` in the Exit menu item:
```typescript
          <MenubarItem onClick={closeWindow}>Exit</MenubarItem>
```

With:
```typescript
          <MenubarItem onClick={() => platform.windows.close()}>Exit</MenubarItem>
```

Replace the New Window handler:
```typescript
            onClick={() => {
              const id = crypto.randomUUID()
              saveLayout(id, {
                panels: { left: [], right: [], bottom: [] },
                sizes: { left: [], right: [], bottom: [] },
                activeTab: {},
              })
              void broadcast({ type: 'window-opened', windowId: id })
              createWindow(id)
            }}
```

With:
```typescript
            onClick={() => {
              const id = crypto.randomUUID()
              saveLayout(id, {
                panels: { left: [], right: [], bottom: [] },
                sizes: { left: [], right: [], bottom: [] },
                activeTab: {},
              })
              void platform.ipc.emit('window-opened', { windowId: id })
              void platform.windows.create(id)
            }}
```

- [ ] **Step 2: Update `src/components/Layout/index.tsx`**

Replace:
```typescript
import { getWindowId } from '@/services/platform'
```

With:
```typescript
import { getPlatform } from '@/services/platform'
```

Replace:
```typescript
  const windowId = getWindowId()
```

With:
```typescript
  const windowId = getPlatform().windows.getWindowId()
```

- [ ] **Step 3: Commit**

```bash
git add src/components/Layout/TopBar.tsx src/components/Layout/index.tsx
git commit -m "refactor: migrate TopBar and Layout to platform APIs"
```

---

## Task 11: Migrate main.tsx and delete old files

**Files:**
- Modify: `src/main.tsx`
- Delete: `src/services/platform.ts`
- Delete: `src/services/channel.ts`
- Delete: `src/services/storage.ts`
- Delete: `src/services/filesystem.ts`
- Delete: `src/services/windowPosition.ts`

- [ ] **Step 1: Rewrite `src/main.tsx`**

Replace the entire file:

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initPlatform } from '@/services/platform'
import { TooltipProvider } from '@/components/ui/tooltip'
import './index.css'
import '@/store/console'
import App from './App'

async function bootstrap() {
  await initPlatform()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </StrictMode>,
  )
}

bootstrap()
```

- [ ] **Step 2: Delete old service files**

```bash
rm src/services/platform.ts
rm src/services/channel.ts
rm src/services/storage.ts
rm src/services/filesystem.ts
rm src/services/windowPosition.ts
```

- [ ] **Step 3: Verify no remaining imports of deleted modules**

Run:
```bash
grep -r "from '@/services/platform'" src/ --include='*.ts' --include='*.tsx' | grep -v 'platform/'
grep -r "from '@/services/channel'" src/ --include='*.ts' --include='*.tsx'
grep -r "from '@/services/storage'" src/ --include='*.ts' --include='*.tsx'
grep -r "from '@/services/filesystem'" src/ --include='*.ts' --include='*.tsx'
grep -r "from '@/services/windowPosition'" src/ --include='*.ts' --include='*.tsx'
grep -r "@neutralinojs" src/ --include='*.ts' --include='*.tsx'
```

Expected: no matches (docs/ files are ok to ignore).

- [ ] **Step 4: Commit**

```bash
git add src/main.tsx
git rm src/services/platform.ts src/services/channel.ts src/services/storage.ts src/services/filesystem.ts src/services/windowPosition.ts
git commit -m "refactor: remove Neutralino dependencies, delete old service files"
```

---

## Task 12: Update layout store persistence import

**Files:**
- Modify: `src/store/layout.ts:2`

- [ ] **Step 1: Verify layout.ts imports**

`src/store/layout.ts` imports from `@/services/windowManager` which still exists and has been migrated. No change needed here — `saveLayout` is still exported from `windowManager.ts`, just now using `getPlatform()` internally.

Verify the import still works:
```typescript
import { saveLayout, type PersistedLayout } from '@/services/windowManager'
```

This is correct — no change needed.

- [ ] **Step 2: Commit (skip if no changes)**

No commit needed for this task.

---

## Task 13: Build verification

- [ ] **Step 1: Install Rust dependencies and verify Tauri builds**

```bash
cd /home/grzracz/dev/cotect
yarn install
```

- [ ] **Step 2: Run TypeScript type check**

```bash
cd /home/grzracz/dev/cotect
npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 3: Run Vite build**

```bash
cd /home/grzracz/dev/cotect
yarn vite:build
```

Expected: successful build.

- [ ] **Step 4: Run `yarn dev` to verify Tauri launches**

```bash
cd /home/grzracz/dev/cotect
yarn dev
```

Expected: Tauri window opens with the React app. Verify:
1. Main window appears
2. Panels are visible
3. Menu bar works
4. "New Window" creates a child window
5. Dragging a panel between windows works
6. Window positions are restored on restart

- [ ] **Step 5: Commit final state**

```bash
git add -A
git commit -m "feat: complete Neutralino to Tauri v2 migration"
```

---

## Task 14: Remove `index.html` Neutralino script tag (if present)

- [ ] **Step 1: Check `index.html` for Neutralino references**

```bash
grep -n "neutralino" /home/grzracz/dev/cotect/index.html
```

If there's a `<script src="/__neutralino_globals.js"></script>` tag, remove it.

- [ ] **Step 2: Commit if changed**

```bash
git add index.html
git commit -m "chore: remove Neutralino script tag from index.html"
```
