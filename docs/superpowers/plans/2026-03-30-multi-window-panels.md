# Multi-Window Panel System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable multi-window panel management with cross-window drag-and-drop, layout persistence, and window lifecycle handling.

**Architecture:** BroadcastChannel for cross-window IPC, localStorage for persistence, thin platform abstraction to keep Neutralino decoupled. Each window has its own Zustand layout store instance seeded from localStorage. Cross-window drag uses shared drag state broadcast + native mouse events on the receiving window.

**Tech Stack:** React, Zustand, @dnd-kit/core, BroadcastChannel API, localStorage, NeutralinoJS (optional runtime)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/services/platform.ts` | **New.** Thin abstraction: `createWindow`, `closeWindow`, `onWindowClose`, `getWindowId`. Only file with Neutralino imports. |
| `src/services/channel.ts` | **New.** BroadcastChannel wrapper: `broadcast`, `onMessage`, `close`. Message type definitions. |
| `src/services/windowManager.ts` | **New.** Window registry in localStorage, layout persistence (save/restore), startup window restoration. |
| `src/store/layout.ts` | **Modify.** Add `loadLayout`/`getSerializableState` methods. Subscribe to changes → persist via windowManager. |
| `src/App.tsx` | **Modify.** Window ID resolution, close handling, startup restore for child windows. |
| `src/views/NewWindow.tsx` | **Modify.** Replace placeholder with Layout (no ReactFlow). |
| `src/components/Layout/TopBar.tsx` | **Modify.** Spawn window with UUID, register in windowManager. |
| `src/components/Layout/usePanelDrag.ts` | **Modify.** Broadcast `drag-start`/`drag-end` on channel. |
| `src/components/Layout/index.tsx` | **Modify.** Add `CrossWindowDropOverlay` that listens to channel for incoming drags and renders native-mouse-event drop zones. |
| `src/components/Layout/CrossWindowDropOverlay.tsx` | **New.** Overlay component: listens for `drag-start` from other windows, tracks mouse position + button state, broadcasts `drag-drop` on mouseup over a zone. |

---

### Task 1: Platform Abstraction

**Files:**
- Create: `src/services/platform.ts`

- [ ] **Step 1: Create `src/services/platform.ts`**

```typescript
import { app, window as neuWindow, events } from '@neutralinojs/lib'

function isNeutralino(): boolean {
  return typeof window !== 'undefined' && !!window.NL_PORT
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

export function closeWindow(): void {
  if (isNeutralino()) {
    app.exit().catch(() => window.close())
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
```

- [ ] **Step 2: Verify** — Run `npx tsc --noEmit` to confirm types pass.

- [ ] **Step 3: Commit**

```bash
git add src/services/platform.ts
git commit -m "feat: add platform abstraction for window lifecycle"
```

---

### Task 2: BroadcastChannel Wrapper

**Files:**
- Create: `src/services/channel.ts`

- [ ] **Step 1: Create `src/services/channel.ts`**

```typescript
import type { PanelPosition } from '@/store/layout'

export type ChannelMessage =
  | { type: 'drag-start'; panelId: string; panelIds: string[]; sourceWindow: string }
  | { type: 'drag-end'; sourceWindow: string }
  | { type: 'drag-drop'; panelId: string; panelIds: string[]; targetWindow: string; position: PanelPosition; groupKey: string | null }
  | { type: 'window-opened'; windowId: string }
  | { type: 'window-closed'; windowId: string }

let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel {
  if (!channel) {
    channel = new BroadcastChannel('cotect')
  }
  return channel
}

export function broadcast(message: ChannelMessage): void {
  getChannel().postMessage(message)
}

export function onMessage(handler: (message: ChannelMessage) => void): () => void {
  const ch = getChannel()
  const listener = (event: MessageEvent<ChannelMessage>) => handler(event.data)
  ch.addEventListener('message', listener)
  return () => ch.removeEventListener('message', listener)
}

export function closeChannel(): void {
  if (channel) {
    channel.close()
    channel = null
  }
}
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit`.

- [ ] **Step 3: Commit**

```bash
git add src/services/channel.ts
git commit -m "feat: add BroadcastChannel wrapper for cross-window IPC"
```

---

### Task 3: Window Manager (Registry + Persistence)

**Files:**
- Create: `src/services/windowManager.ts`

- [ ] **Step 1: Create `src/services/windowManager.ts`**

```typescript
import type { PanelPosition } from '@/store/layout'

const WINDOWS_KEY = 'cotect:windows'
const LAYOUT_PREFIX = 'cotect:layout:'
const ZONE_SIZES_PREFIX = 'cotect:zones:'

export interface WindowDescriptor {
  id: string
  role: 'main' | 'panel'
}

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

// --- Window registry ---

export function getWindows(): WindowDescriptor[] {
  try {
    return JSON.parse(localStorage.getItem(WINDOWS_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function registerWindow(id: string, role: 'main' | 'panel'): void {
  const windows = getWindows().filter((w) => w.id !== id)
  windows.push({ id, role })
  localStorage.setItem(WINDOWS_KEY, JSON.stringify(windows))
}

export function unregisterWindow(id: string): void {
  const windows = getWindows().filter((w) => w.id !== id)
  localStorage.setItem(WINDOWS_KEY, JSON.stringify(windows))
}

// --- Layout persistence ---

export function saveLayout(windowId: string, layout: PersistedLayout): void {
  localStorage.setItem(LAYOUT_PREFIX + windowId, JSON.stringify(layout))
}

export function loadLayout(windowId: string): PersistedLayout | null {
  try {
    const raw = localStorage.getItem(LAYOUT_PREFIX + windowId)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function removeLayout(windowId: string): void {
  localStorage.removeItem(LAYOUT_PREFIX + windowId)
  localStorage.removeItem(ZONE_SIZES_PREFIX + windowId)
}

export function saveZoneSizes(windowId: string, sizes: PersistedZoneSizes): void {
  localStorage.setItem(ZONE_SIZES_PREFIX + windowId, JSON.stringify(sizes))
}

export function loadZoneSizes(windowId: string): PersistedZoneSizes | null {
  try {
    const raw = localStorage.getItem(ZONE_SIZES_PREFIX + windowId)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit`.

- [ ] **Step 3: Commit**

```bash
git add src/services/windowManager.ts
git commit -m "feat: add window manager for registry and layout persistence"
```

---

### Task 4: Layout Store — Persistence Integration

**Files:**
- Modify: `src/store/layout.ts`

This task adds `loadLayout` (to seed from localStorage), `getSerializableState` (to extract persistable state), and a `subscribeWithPersistence` helper that components call to wire up auto-save.

- [ ] **Step 1: Add persistence methods to layout store**

At the end of `src/store/layout.ts`, after the existing `useLayoutStore` definition, add:

```typescript
// --- Persistence helpers ---

export function getSerializableLayout(): PersistedLayout {
  const { panels, sizes, activeTab } = useLayoutStore.getState()
  return { panels, sizes, activeTab }
}

export function loadLayoutIntoStore(saved: PersistedLayout): void {
  useLayoutStore.setState({
    panels: saved.panels,
    sizes: saved.sizes,
    activeTab: saved.activeTab,
  })
}

let persistUnsub: (() => void) | null = null

export function startLayoutPersistence(windowId: string): void {
  // Avoid double-subscribe
  if (persistUnsub) persistUnsub()

  let timer: ReturnType<typeof setTimeout> | null = null
  persistUnsub = useLayoutStore.subscribe(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      saveLayout(windowId, getSerializableLayout())
    }, 300)
  })
}

export function stopLayoutPersistence(): void {
  if (persistUnsub) {
    persistUnsub()
    persistUnsub = null
  }
}
```

Also add the import at the top of the file:

```typescript
import { saveLayout, type PersistedLayout } from '@/services/windowManager'
```

And export `PersistedLayout` as a re-export is not needed since windowManager owns the type. The store just imports and uses it.

- [ ] **Step 2: Change the default initial state to empty panels**

Replace the hardcoded initial state in the `create<LayoutState>` call:

```typescript
// Old:
panels: {
  left: [['explorer']],
  right: [['chat']],
  bottom: [['console']],
},
sizes: {
  left: [1],
  right: [1],
  bottom: [1],
},
activeTab: {},

// New:
panels: {
  left: [],
  right: [],
  bottom: [],
},
sizes: {
  left: [],
  right: [],
  bottom: [],
},
activeTab: {},
```

The main window will immediately load its persisted state (or a default) in App.tsx — see Task 6.

- [ ] **Step 3: Verify** — `npx tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add src/store/layout.ts
git commit -m "feat: add layout persistence helpers to store"
```

---

### Task 5: NewWindow View — Full Panel Layout

**Files:**
- Modify: `src/views/NewWindow.tsx`

- [ ] **Step 1: Replace placeholder with full layout**

```typescript
import Layout from '@/components/Layout'

export default function NewWindow() {
  return (
    <div className="dark w-screen h-screen bg-background text-foreground relative">
      <div className="absolute inset-0 pointer-events-none z-10">
        <Layout />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit`.

- [ ] **Step 3: Commit**

```bash
git add src/views/NewWindow.tsx
git commit -m "feat: replace NewWindow placeholder with full panel layout"
```

---

### Task 6: App.tsx — Window Lifecycle + Persistence Wiring

**Files:**
- Modify: `src/App.tsx`

This is the central wiring point. On mount: resolve window ID, register window, load persisted layout into store, start persistence, handle close, restore child windows (main only).

- [ ] **Step 1: Rewrite `src/App.tsx`**

```typescript
import { useEffect } from 'react'
import { window as neuWindow } from '@neutralinojs/lib'
import Canvas from '@/views/Canvas'
import NewWindow from '@/views/NewWindow'
import { getWindowId, onWindowClose, createWindow } from '@/services/platform'
import { broadcast, onMessage, closeChannel } from '@/services/channel'
import {
  registerWindow,
  unregisterWindow,
  loadLayout,
  getWindows,
  removeLayout,
} from '@/services/windowManager'
import {
  loadLayoutIntoStore,
  startLayoutPersistence,
  stopLayoutPersistence,
} from '@/store/layout'

const windowId = getWindowId()
const isMain = windowId === 'main'

const DEFAULT_MAIN_LAYOUT = {
  panels: { left: [['explorer']], right: [['chat']], bottom: [['console']] },
  sizes: { left: [1], right: [1], bottom: [1] },
  activeTab: {},
}

function App() {
  useEffect(() => {
    // Set window size constraints in Neutralino
    if (window.NL_PORT) {
      neuWindow.setSize({ minWidth: isMain ? 1280 : 400, minHeight: isMain ? 720 : 300 }).catch(() => {})
    }

    // Register this window
    registerWindow(windowId, isMain ? 'main' : 'panel')
    broadcast({ type: 'window-opened', windowId })

    // Load persisted layout (or default for main)
    const saved = loadLayout(windowId)
    if (saved) {
      loadLayoutIntoStore(saved)
    } else if (isMain) {
      loadLayoutIntoStore(DEFAULT_MAIN_LAYOUT)
    }

    // Start auto-persisting layout changes
    startLayoutPersistence(windowId)

    // Restore child windows (main only, on startup)
    if (isMain) {
      const windows = getWindows()
      for (const w of windows) {
        if (w.id !== 'main' && w.role === 'panel') {
          // Only restore if layout data exists (window was properly saved)
          const childLayout = loadLayout(w.id)
          if (childLayout) {
            createWindow(w.id)
          } else {
            // Stale entry — clean up
            unregisterWindow(w.id)
          }
        }
      }
    }

    // Listen for other windows closing (clean up stale entries)
    const unsubMessage = onMessage((msg) => {
      if (msg.type === 'window-closed' && isMain) {
        // Main window cleans up closed window data after a delay
        // (the closing window already unregistered itself)
      }
    })

    // Handle this window closing
    const unsubClose = onWindowClose(() => {
      stopLayoutPersistence()
      unregisterWindow(windowId)
      if (!isMain) {
        removeLayout(windowId)
      }
      broadcast({ type: 'window-closed', windowId })
      closeChannel()
    })

    return () => {
      unsubMessage()
      unsubClose()
      stopLayoutPersistence()
    }
  }, [])

  if (!isMain) return <NewWindow />
  return <Canvas />
}

export default App
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit`.

- [ ] **Step 3: Manual test** — Run `yarn dev`. Main window should load with default panels (explorer, chat, console). Move a panel, close and reopen — layout should persist. Open "New Window" — should open empty. Add panels via View menu in new window. Close and reopen app — both windows should restore.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire window lifecycle, persistence, and restore"
```

---

### Task 7: TopBar — Window Spawning via Platform Service

**Files:**
- Modify: `src/components/Layout/TopBar.tsx`

Replace the inline `neuWindow.create` call with `createWindow(uuid)` from platform service, and register the new window.

- [ ] **Step 1: Update TopBar.tsx**

Replace the `import` for `@neutralinojs/lib`:

```typescript
// Remove:
import { os, window as neuWindow } from '@neutralinojs/lib'

// Add:
import { os } from '@neutralinojs/lib'
import { createWindow } from '@/services/platform'
import { registerWindow, saveLayout } from '@/services/windowManager'
import { broadcast } from '@/services/channel'
```

Replace the "New Window" `MenubarItem` onClick handler:

```typescript
<MenubarItem
  onClick={() => {
    const id = crypto.randomUUID()
    saveLayout(id, {
      panels: { left: [], right: [], bottom: [] },
      sizes: { left: [], right: [], bottom: [] },
      activeTab: {},
    })
    registerWindow(id, 'panel')
    broadcast({ type: 'window-opened', windowId: id })
    createWindow(id)
  }}
>
  New Window
</MenubarItem>
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit`.

- [ ] **Step 3: Manual test** — Click "New Window" in View menu. A new window should open with empty panel layout and a TopBar. The View menu in the new window should allow toggling panels on/off.

- [ ] **Step 4: Commit**

```bash
git add src/components/Layout/TopBar.tsx
git commit -m "feat: spawn windows via platform service with UUID and persistence"
```

---

### Task 8: Layout Zone Size Persistence

**Files:**
- Modify: `src/components/Layout/index.tsx`

The zone sizes (left/right/bottom ratios) are currently local `useState`. We need to persist them too.

- [ ] **Step 1: Wire zone size persistence in Layout**

Add imports at the top:

```typescript
import { getWindowId } from '@/services/platform'
import { saveZoneSizes, loadZoneSizes } from '@/services/windowManager'
```

Replace the `useState` for `zoneSizes` with one that loads from localStorage:

```typescript
const windowId = getWindowId()
const [zoneSizes, setZoneSizes] = useState(() => {
  const saved = loadZoneSizes(windowId)
  return saved ?? { left: 0.2, right: 0.2, bottom: 0.25 }
})
```

Add a `useEffect` to persist zone size changes (debounced):

```typescript
useEffect(() => {
  const timer = setTimeout(() => {
    saveZoneSizes(windowId, zoneSizes)
  }, 300)
  return () => clearTimeout(timer)
}, [windowId, zoneSizes])
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit`.

- [ ] **Step 3: Commit**

```bash
git add src/components/Layout/index.tsx
git commit -m "feat: persist zone sizes per window"
```

---

### Task 9: Broadcast Drag Events from Source Window

**Files:**
- Modify: `src/components/Layout/usePanelDrag.ts`

When a drag starts, broadcast `drag-start`. When it ends or cancels, broadcast `drag-end`.

- [ ] **Step 1: Add channel imports and broadcasts**

Add at the top:

```typescript
import { broadcast } from '@/services/channel'
import { getWindowId } from '@/services/platform'
```

In `handleDragStart`, after `setDragState(...)`, add:

```typescript
broadcast({
  type: 'drag-start',
  panelId: data.panelId,
  panelIds: data.isGroup ? data.panelIds : [data.panelId],
  sourceWindow: getWindowId(),
})
```

In `handleDragEnd`, at the very end (after the `setDragState` call), add:

```typescript
broadcast({ type: 'drag-end', sourceWindow: getWindowId() })
```

In `handleDragCancel`, after `setDragState(null)`, add:

```typescript
broadcast({ type: 'drag-end', sourceWindow: getWindowId() })
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit`.

- [ ] **Step 3: Commit**

```bash
git add src/components/Layout/usePanelDrag.ts
git commit -m "feat: broadcast drag start/end events to other windows"
```

---

### Task 10: Cross-Window Drop Overlay

**Files:**
- Create: `src/components/Layout/CrossWindowDropOverlay.tsx`
- Modify: `src/components/Layout/index.tsx`

This is the core cross-window drag target. When another window broadcasts `drag-start`, this overlay activates. It tracks native mouse events (not @dnd-kit, since the drag didn't originate here). When the mouse enters with a button held, it shows drop zone highlights. On mouseup, it broadcasts `drag-drop`.

- [ ] **Step 1: Create `src/components/Layout/CrossWindowDropOverlay.tsx`**

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'
import { onMessage, broadcast, type ChannelMessage } from '@/services/channel'
import { getWindowId } from '@/services/platform'
import { useLayoutStore, type PanelPosition } from '@/store/layout'

interface IncomingDrag {
  panelId: string
  panelIds: string[]
  sourceWindow: string
}

type HoverZone = PanelPosition | null

export default function CrossWindowDropOverlay() {
  const [incoming, setIncoming] = useState<IncomingDrag | null>(null)
  const [hoverZone, setHoverZone] = useState<HoverZone>(null)
  const [mouseInWindow, setMouseInWindow] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)
  const windowId = getWindowId()

  // Listen for cross-window drag messages
  useEffect(() => {
    return onMessage((msg: ChannelMessage) => {
      if (msg.type === 'drag-start' && msg.sourceWindow !== windowId) {
        setIncoming({ panelId: msg.panelId, panelIds: msg.panelIds, sourceWindow: msg.sourceWindow })
      } else if (msg.type === 'drag-end' && msg.sourceWindow !== windowId) {
        setIncoming(null)
        setHoverZone(null)
        setMouseInWindow(false)
      }
    })
  }, [windowId])

  // Detect zone from mouse position
  const detectZone = useCallback((clientX: number, clientY: number): HoverZone => {
    const w = window.innerWidth
    const h = window.innerHeight
    const x = clientX / w
    const y = clientY / h

    // Bottom 25%
    if (y > 0.75) return 'bottom'
    // Left 25%
    if (x < 0.25) return 'left'
    // Right 25%
    if (x > 0.75) return 'right'

    return null
  }, [])

  // Track mouse movement when incoming drag is active
  useEffect(() => {
    if (!incoming) return

    const handleMouseMove = (e: MouseEvent) => {
      // Only track if a mouse button is held (cross-window drag in progress)
      if (e.buttons > 0) {
        setMouseInWindow(true)
        setHoverZone(detectZone(e.clientX, e.clientY))
      }
    }

    const handleMouseEnter = (e: MouseEvent) => {
      if (e.buttons > 0) {
        setMouseInWindow(true)
      } else {
        // Mouse entered without button — drag was released outside, clean up
        setIncoming(null)
        setHoverZone(null)
        setMouseInWindow(false)
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (!incoming || !mouseInWindow) return

      const zone = detectZone(e.clientX, e.clientY)
      if (zone) {
        // Broadcast drop to source window and handle locally
        broadcast({
          type: 'drag-drop',
          panelId: incoming.panelId,
          panelIds: incoming.panelIds,
          targetWindow: windowId,
          position: zone,
          groupKey: null,
        })

        // Add panels to this window's store (as a tabbed group)
        const store = useLayoutStore.getState()
        store.addPanel(incoming.panelIds[0], zone)
        for (let i = 1; i < incoming.panelIds.length; i++) {
          store.addPanel(incoming.panelIds[i], zone)
          store.movePanelToTab(incoming.panelIds[i], incoming.panelIds[0])
        }
      }

      setIncoming(null)
      setHoverZone(null)
      setMouseInWindow(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseenter', handleMouseEnter)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseenter', handleMouseEnter)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [incoming, mouseInWindow, detectZone, windowId])

  if (!incoming || !mouseInWindow) return null

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-50 pointer-events-none"
    >
      {/* Left zone highlight */}
      <div
        className={`absolute left-0 top-0 w-1/4 h-3/4 border-2 border-dashed rounded-sm transition-colors ${
          hoverZone === 'left' ? 'border-primary/60 bg-primary/10' : 'border-transparent'
        }`}
      />
      {/* Right zone highlight */}
      <div
        className={`absolute right-0 top-0 w-1/4 h-3/4 border-2 border-dashed rounded-sm transition-colors ${
          hoverZone === 'right' ? 'border-primary/60 bg-primary/10' : 'border-transparent'
        }`}
      />
      {/* Bottom zone highlight */}
      <div
        className={`absolute left-0 bottom-0 w-full h-1/4 border-2 border-dashed rounded-sm transition-colors ${
          hoverZone === 'bottom' ? 'border-primary/60 bg-primary/10' : 'border-transparent'
        }`}
      />
      {/* Center label */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="bg-background/90 backdrop-blur-sm px-4 py-2 rounded-lg border border-border shadow-lg">
          <span className="text-sm text-muted-foreground">
            {hoverZone
              ? `Drop in ${hoverZone} panel`
              : 'Move to a zone to drop'}
          </span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add CrossWindowDropOverlay to Layout**

In `src/components/Layout/index.tsx`, add the import:

```typescript
import CrossWindowDropOverlay from './CrossWindowDropOverlay'
```

Inside the return JSX, add it as the last child of the outermost `div` (after `</DndContext>`):

```typescript
      </DndContext>
      <CrossWindowDropOverlay />
    </div>
  )
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add src/components/Layout/CrossWindowDropOverlay.tsx src/components/Layout/index.tsx
git commit -m "feat: add cross-window drop overlay for receiving panel drags"
```

---

### Task 11: Handle Cross-Window Drop on Source Side

**Files:**
- Modify: `src/components/Layout/usePanelDrag.ts`

When the source window receives a `drag-drop` message from another window, it needs to remove the transferred panels from its own store.

- [ ] **Step 1: Add channel listener for incoming `drag-drop`**

In `usePanelDrag`, add a `useEffect` that listens for `drag-drop` messages targeting other windows (meaning this window is the source):

Add import at top (if not already present):

```typescript
import { useEffect } from 'react'
import { onMessage } from '@/services/channel'
```

Update the existing imports from `react`:

```typescript
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
```

Add inside the `usePanelDrag` function body, before the `return` statement:

```typescript
// Listen for cross-window drops (this window is the source)
useEffect(() => {
  return onMessage((msg) => {
    if (msg.type === 'drag-drop' && msg.targetWindow !== getWindowId()) {
      // Another window accepted the drop — remove panels from our store
      for (const id of msg.panelIds) {
        useLayoutStore.getState().removePanel(id)
      }
    }
  })
}, [])
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit`.

- [ ] **Step 3: Manual test** — Open two windows. Drag a panel tab in Window A past the boundary. Let go of mouse inside Window B over a zone highlight. The panel should disappear from Window A and appear in Window B.

- [ ] **Step 4: Commit**

```bash
git add src/components/Layout/usePanelDrag.ts
git commit -m "feat: handle cross-window drop by removing panels from source"
```

---

### Task 12: Final Integration Test

- [ ] **Step 1: Full manual test sequence**

1. **Window close**: Open a new window via View → New Window. Click the OS close button. The window should close cleanly (no zombie process).
2. **Panel layout in new window**: New window should have a TopBar with View menu. Toggle panels on/off. Resize zones. All should work identically to main window.
3. **Layout persistence**: Arrange panels in main window and new window. Close the app entirely. Reopen — both windows should restore with their layouts.
4. **Cross-window drag**: Open two windows. Add a panel (e.g., Terminal) to Window B. Drag a panel tab in Window A. Mouse leaves Window A, enters Window B with button held. Zone highlights should appear. Release mouse over a zone — panel transfers from A to B. Verify panel is gone from A and present in B.
5. **Edge case — drop outside**: Start dragging in Window A. Release mouse outside any window. Panel should stay in Window A (no-op).
6. **Edge case — close during drag**: Start dragging in Window A. Close Window A. Window B should clean up drag state (no stuck overlay).

- [ ] **Step 2: Fix any issues found**

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: multi-window panel system with cross-window drag and persistence"
```
