# Multi-Window Panel System

## Problem

New windows cannot be closed, have no panel layout, and panels cannot move between windows.

## Design

### Data Model & Persistence

Window state stored in `localStorage`:

- `cotect:windows` — ordered list of window descriptors: `[{ id: string, role: 'main' | 'panel' }]`
- `cotect:layout:{windowId}` — full layout state per window (panels, sizes, activeTab)

Window IDs passed via URL query param `/?window={id}`. Main window uses stable ID `"main"`. Panel windows get UUIDs at creation time.

Layout persisted on every change via Zustand `subscribe` with debounced writes. Window list updated on open/close.

On startup, main window reads `cotect:windows`, restores its own layout, spawns any additional windows that were previously open. Each spawned window restores its layout from its own localStorage key.

### Cross-Window Communication

`BroadcastChannel` named `"cotect"` carries all messages:

| Message | Fields |
|---------|--------|
| `drag-start` | `panelId`, `panelIds`, `sourceWindow` |
| `drag-end` | (none) |
| `drag-drop` | `panelId`, `panelIds`, `targetWindow`, `position`, `groupKey?` |
| `layout-changed` | `windowId` |
| `window-opened` | `windowId` |
| `window-closed` | `windowId` |

#### Cross-window drag flow

1. Window A starts dragging — broadcasts `drag-start`
2. Mouse leaves Window A — @dnd-kit fires cancel; panel is NOT removed yet
3. Mouse enters Window B with button held (`mouseenter` with `event.buttons > 0`) — Window B shows drop zones with ghost preview
4. User releases mouse over drop zone in Window B — Window B broadcasts `drag-drop`
5. Window A receives `drag-drop`, removes panel from its store
6. Window B adds panel to its store at specified position
7. Both windows persist updated layouts

#### Edge cases

- Mouse released outside any window: no `drag-drop` received, Window A keeps panel (no-op)
- Source window closed during drag: `drag-end` broadcast, target ignores
- Drag cancelled within same window: `drag-end` broadcast as cleanup

### Window Lifecycle

**Close handling:** All windows listen for Neutralino `windowClose` event (desktop) or `beforeunload` (browser). On close: broadcast `window-closed`, remove from `cotect:windows`, call `app.exit()` (Neutralino) or `window.close()` (browser).

**New window layout:** `NewWindow` component replaced with full panel layout — same as main window but without ReactFlow graph. Reuses `Layout`, `DropZone`, `PanelArea` components. Each window has its own `useLayoutStore` seeded from localStorage or empty on first open.

**Window spawning:** "New Window" generates UUID, saves empty layout to localStorage, adds to `cotect:windows`, calls `window.create()` (Neutralino) or `window.open()` (browser) with `?window={id}`.

**Startup restore:** Main window reads `cotect:windows` and re-spawns non-main windows.

### Cross-Window Drop Zone

During active cross-window drag (received `drag-start` from another window), target window renders a lightweight drag overlay using native mouse events (not @dnd-kit — drag didn't originate in this window). Overlay detects quadrant from mouse position (left/right/bottom) and highlights target zone. On `mouseup`, broadcasts `drag-drop` with resolved position.

### Abstraction Layer

**`src/services/platform.ts`** — platform-specific operations:
- `createWindow(id)` — `neuWindow.create()` or `window.open()`
- `closeWindow()` — `app.exit()` or `window.close()`
- `onWindowClose(callback)` — Neutralino `windowClose` or `beforeunload`
- `getWindowId()` — reads `?window=` param, defaults to `"main"`

**`src/services/channel.ts`** — wraps `BroadcastChannel`:
- `broadcast(message)` / `onMessage(handler)` / `close()`
- Pure web API, no platform branching

All Neutralino-specific code stays in `platform.ts`. If Neutralino is dropped, only that file changes.

### Per-Window Store Isolation

Current `useLayoutStore` is a module-level Zustand singleton. Each window/process has its own JS context, so each gets its own store instance. Store subscribes to changes and debounce-writes to localStorage under its own key.

## Files Changed

| File | Change |
|------|--------|
| `src/services/platform.ts` | New — platform abstraction |
| `src/services/channel.ts` | New — BroadcastChannel wrapper |
| `src/views/NewWindow.tsx` | Replace placeholder with full panel layout |
| `src/App.tsx` | Window ID management, close handling, startup restore |
| `src/main.tsx` | Window close event registration |
| `src/store/layout.ts` | localStorage persistence, cross-window drag state |
| `src/components/Layout/index.tsx` | Cross-window drop overlay |
| `src/components/Layout/TopBar.tsx` | Window spawning with UUID + persistence |
| `src/components/Layout/usePanelDrag.ts` | Broadcast drag events |
