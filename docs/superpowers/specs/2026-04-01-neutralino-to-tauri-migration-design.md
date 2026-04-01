# Neutralino to Tauri v2 Migration

## Problem

Neutralino lacks reliable access to Wayland APIs. Specifically:
- `neuWindow.getPosition()` returns `(0, 0)` on Wayland with server-side decorations
- `window.outerHeight` excludes title bar decorations, requiring pointer-event hacks to detect offsets
- No built-in IPC — cross-window communication relies on polling `/tmp` files at 30ms intervals
- No global cursor position API — cross-window drag hit-testing depends on unreliable coordinate mapping

These limitations make cross-window panel dragging — a core product requirement — fundamentally broken on Wayland.

## Solution

Replace Neutralino with Tauri v2. Introduce a platform abstraction layer so the React app can run in both Tauri (desktop) and browser environments.

## Requirements

- Multi-window with cross-window panel drag-and-drop (essential, non-negotiable)
- All three platforms: Linux, macOS, Windows
- Lean binary — use system webview, avoid bundling Chromium
- Platform abstraction — decouple React app from native runtime so a browser version is feasible later
- No preference on backend runtime language

---

## Architecture

```
+---------------------------------------------+
|  Tauri Rust Core (~200 lines)               |
|  - Window management                        |
|  - Plugin registration (store, fs)          |
|  - Custom commands (readDirectory, etc.)    |
+---------------------------------------------+
|  Tauri JS API (@tauri-apps/api)             |
|  - WebviewWindow (create, position, size)   |
|  - emit()/listen() (cross-window events)    |
|  - invoke() (call Rust commands)            |
+---------------------------------------------+
|  Platform Abstraction Layer                  |
|  src/services/platform/                     |
|  - types.ts (Platform interface)            |
|  - tauri.ts (Tauri implementation)          |
|  - browser.ts (browser implementation)      |
|  - index.ts (runtime detection + export)    |
+---------------------------------------------+
|  React App (unchanged)                       |
|  - Components, stores, hooks                |
|  - All service files consume `platform`     |
+---------------------------------------------+
```

---

## Platform Abstraction Layer

### Interface

```typescript
interface Platform {
  windows: {
    create(url: string, opts: WindowOptions): Promise<string>
    getPosition(windowId?: string): Promise<{ x: number; y: number }>
    getSize(windowId?: string): Promise<{ width: number; height: number }>
    move(x: number, y: number): Promise<void>
    resize(width: number, height: number): Promise<void>
    maximize(): Promise<void>
    show(): Promise<void>
    close(windowId: string): Promise<void>
    onClose(callback: () => void): void
  }

  ipc: {
    emit(event: string, payload: unknown): Promise<void>
    listen(event: string, callback: (payload: unknown) => void): () => void
  }

  fs: {
    readFile(path: string): Promise<string>
    writeFile(path: string, content: string): Promise<void>
    readDirectory(path: string): Promise<DirectoryEntry[]>
  }

  storage: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
    remove(key: string): Promise<void>
    listKeys(prefix: string): Promise<string[]>
  }
}
```

### Runtime Detection

```typescript
// src/services/platform/index.ts
import { tauriPlatform } from './tauri'
import { browserPlatform } from './browser'

export const platform: Platform =
  '__TAURI_INTERNALS__' in window ? tauriPlatform : browserPlatform
```

### Browser Implementation

For future web version:
- `windows` — `window.open()` with `BroadcastChannel` for coordination
- `ipc` — `BroadcastChannel` API
- `fs` — not available (or virtual via OPFS)
- `storage` — `localStorage` with `cotect:` prefix

---

## IPC & Cross-Window Drag Migration

### Current (Neutralino)

1. Window A writes drag position to `/tmp/cotect-drag-pos.json`
2. Window B polls the file every 30ms, parses JSON, hit-tests coordinates
3. State transferred via `/tmp/cotect-panel-*.json` files

### New (Tauri)

1. Window A calls `platform.ipc.emit('drag-move', { screenX, screenY, panelId })`
2. Window B has `platform.ipc.listen('drag-move', handler)` — fires instantly
3. Panel state carried directly in the drop event payload

### Window Position for Hit-Testing

Tauri's `WebviewWindow.outerPosition()` and `WebviewWindow.outerSize()` include window decorations and work correctly on Wayland. This eliminates:
- The Wayland SSD detection code in `windowPosition.ts`
- Pointer-event-based decoration offset measurement
- The `getPositionForPersistence()` fallback chain

Hit-testing becomes:

```typescript
async function getWindowBounds() {
  const pos = await platform.windows.getPosition()
  const size = await platform.windows.getSize()
  return {
    left: pos.x,
    top: pos.y,
    right: pos.x + size.width,
    bottom: pos.y + size.height
  }
}
```

### Drag Event Flow

```
drag-start  →  platform.ipc.emit('drag-start', { panelId, panelIds, sourceWindow })
drag-move   →  platform.ipc.emit('drag-move', { screenX, screenY })
drag-end    →  platform.ipc.emit('drag-end', {})
drag-drop   →  platform.ipc.emit('drag-drop', { panelId, targetWindow, zone, panelState })
```

---

## State Persistence & Live Sync

### Persistence

Uses `tauri-plugin-store` for disk-backed key-value storage:

```typescript
// Tauri platform.storage implementation
import { Store } from '@tauri-apps/plugin-store'

const store = await Store.load('app-state.json', { autoSave: true })

storage: {
  get: (key) => store.get(key),
  set: (key, value) => store.set(key, value),
  remove: (key) => store.delete(key),
  listKeys: (prefix) => store.keys().then(keys => keys.filter(k => k.startsWith(prefix)))
}
```

### Live Cross-Window Sync

Zustand store changes broadcast deltas over IPC:

```typescript
// In createSyncedStore:
store.subscribe((state, prevState) => {
  const delta = computeDelta(state, prevState)
  if (delta) {
    platform.storage.set(`panel-${id}`, JSON.stringify(state))
    platform.ipc.emit(`store-sync:${id}`, { state, source: windowId })
  }
})

// Every window listens:
platform.ipc.listen(`store-sync:${id}`, ({ state, source }) => {
  if (source !== windowId) {
    store.setState(state)  // apply without re-triggering broadcast
  }
})
```

### Panel Transfer During Drag

The drop event carries the full panel state snapshot in its payload. The target window hydrates its local Zustand store directly from the event data — no disk round-trip.

---

## Project Structure

```
cotect/
├── src/                          # React app (mostly unchanged)
│   ├── components/
│   ├── hooks/
│   ├── services/
│   │   └── platform/             # New abstraction layer
│   │       ├── types.ts
│   │       ├── tauri.ts
│   │       ├── browser.ts
│   │       └── index.ts
│   ├── store/
│   └── main.tsx
├── src-tauri/                    # New — Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/            # Tauri v2 permission grants
│   └── src/
│       ├── main.rs              # Entry point, plugin registration
│       └── commands.rs          # Custom commands (readDirectory, etc.)
├── package.json
├── vite.config.ts
└── ...
```

### Dependencies Added

- `@tauri-apps/cli` (dev) — Tauri dev server and build tooling
- `@tauri-apps/api` — JS bindings for window, events, invoke
- `@tauri-apps/plugin-store` — persistent key-value storage

### Dependencies Removed

- `@neutralinojs/lib`
- `@neutralinojs/neu` (CLI)

### Build & Dev

- `yarn dev` — mapped to `tauri dev` in package.json, runs Vite + Tauri concurrently
- `yarn build` — mapped to `tauri build`, produces platform-specific binaries
- Existing script names preserved so developer workflow doesn't change

---

## File Migration Map

| Current File | Action | Notes |
|---|---|---|
| `neutralino.config.json` | **Delete** | Replaced by `src-tauri/tauri.conf.json` |
| `src/main.tsx` | **Edit** | Remove `Neutralino.init()`, platform auto-detects |
| `src/services/platform.ts` | **Replace** | Becomes `platform/` directory with interface + implementations |
| `src/services/windowManager.ts` | **Refactor** | Use `platform.windows` + `platform.storage` |
| `src/services/windowPosition.ts` | **Delete** | Tauri APIs handle decoration-aware positioning natively |
| `src/services/channel.ts` | **Delete** | Replaced by `platform.ipc` |
| `src/services/storage.ts` | **Replace** | Replaced by `platform.storage` |
| `src/services/filesystem.ts` | **Replace** | Replaced by `platform.fs` |
| `src/hooks/useWindowLifecycle.ts` | **Refactor** | Use `platform.windows` for lifecycle |
| `src/components/Layout/usePanelDrag.ts` | **Refactor** | Replace channel broadcasts with `platform.ipc.emit` |
| `src/components/Layout/CrossWindowDropOverlay.tsx` | **Refactor** | Replace polling with `platform.ipc.listen` |
| `src/components/Layout/TopBar.tsx` | **Edit** | Remove Neutralino menu references |
| `src/store/synced.ts` | **Refactor** | IPC-based sync instead of file-based |

---

## What This Does NOT Change

- React component tree and rendering
- Zustand store shapes (layout, chat, console, etc.)
- dnd-kit local drag behavior
- Panel definitions and layout system
- react-resizable-panels split layout
- @xyflow/react canvas
- Tailwind styling
- Vite build pipeline (minor config tweaks only)
