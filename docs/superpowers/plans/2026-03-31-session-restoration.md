# Session Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore full application state across restarts -- window positions/sizes, maximized state, and the project/path being browsed.

**Architecture:** Three independent changes: (1) enable Neutralino's built-in `useSavedState` for the main window, (2) persist and restore child window geometry via `/tmp` files alongside existing layout files, (3) persist and restore the main window's browser state (rootPath, currentPath, viewMode). All persistence uses the existing `fileWrite`/`fileRead` helpers in `windowManager.ts`.

**Tech Stack:** Neutralino.js window API (`getPosition`, `getSize`, `isMaximized`, `move`, `setSize`, `maximize`), Zustand, TypeScript

---

### Task 1: Enable `useSavedState` for main window

**Files:**
- Modify: `neutralino.config.json:27-33`

- [ ] **Step 1: Add `useSavedState` to window config**

In `neutralino.config.json`, add `useSavedState: true` to the `modes.window` object:

```json
"modes": {
  "window": {
    "title": "Cotect",
    "width": 1280,
    "height": 768,
    "minWidth": 1280,
    "minHeight": 720,
    "center": true,
    "useSavedState": true
  }
}
```

- [ ] **Step 2: Verify**

Run the app (`npm run dev` or equivalent). Move/resize the main window. Close and reopen. Confirm it reopens at the same position and size. The `.tmp/window_state.config.json` file should update automatically.

- [ ] **Step 3: Commit**

```bash
git add neutralino.config.json
git commit -m "feat: remember main window position and size across restarts"
```

---

### Task 2: Add geometry persistence helpers to `windowManager.ts`

**Files:**
- Modify: `src/services/windowManager.ts`
- Modify: `src/services/platform.ts`

- [ ] **Step 1: Add `PersistedGeometry` type and save/load/remove functions**

In `src/services/windowManager.ts`, add after the `PersistedZoneSizes` interface and its related functions:

```typescript
export interface PersistedGeometry {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

export function saveGeometry(windowId: string, geometry: PersistedGeometry): void {
  fileWrite(`geometry-${windowId}`, JSON.stringify(geometry))
}

export async function loadGeometry(windowId: string): Promise<PersistedGeometry | null> {
  try {
    const raw = await fileRead(`geometry-${windowId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Extend `removeLayout` to also remove geometry file**

In `src/services/windowManager.ts`, update `removeLayout`:

```typescript
export function removeLayout(windowId: string): void {
  fileRemove(`layout-${windowId}`)
  fileRemove(`zones-${windowId}`)
  fileRemove(`geometry-${windowId}`)
}
```

- [ ] **Step 3: Add geometry auto-persistence functions**

In `src/services/windowManager.ts`, add the imports at the top:

```typescript
import { window as neuWindow } from '@neutralinojs/lib'
import { isNeutralino } from './platform'
```

Then add at the bottom of the file:

```typescript
let geometryUnsub: (() => void) | null = null

export function startGeometryPersistence(windowId: string): void {
  if (geometryUnsub) geometryUnsub()
  if (!isNeutralino()) return

  let timer: ReturnType<typeof setInterval> | null = null

  // Poll every 2 seconds (no resize/move events available in Neutralino)
  let lastJson = ''
  timer = setInterval(async () => {
    try {
      const pos = await neuWindow.getPosition()
      const size = await neuWindow.getSize()
      const maximized = await neuWindow.isMaximized()
      const geometry: PersistedGeometry = {
        x: pos.x,
        y: pos.y,
        width: size.width ?? 800,
        height: size.height ?? 600,
        isMaximized: maximized,
      }
      const json = JSON.stringify(geometry)
      if (json !== lastJson) {
        lastJson = json
        saveGeometry(windowId, geometry)
      }
    } catch {
      // Window may be closing
    }
  }, 2000)

  geometryUnsub = () => {
    if (timer) clearInterval(timer)
    timer = null
  }
}

export function stopGeometryPersistence(): void {
  if (geometryUnsub) {
    geometryUnsub()
    geometryUnsub = null
  }
}
```

- [ ] **Step 4: Update `createWindow` in `platform.ts` to accept geometry**

In `src/services/platform.ts`, update the `createWindow` function to accept an optional geometry parameter and use it:

```typescript
import type { PersistedGeometry } from '@/services/windowManager'
```

Replace the existing `createWindow` function:

```typescript
export function createWindow(id: string, geometry?: PersistedGeometry | null): void {
  if (isNeutralino()) {
    const url = import.meta.env.DEV
      ? `http://localhost:5173/?window=${id}`
      : `/?window=${id}`

    const options: Record<string, unknown> = {
      title: 'Cotect',
      width: geometry?.width ?? 800,
      height: geometry?.height ?? 600,
      minWidth: 400,
      minHeight: 300,
      exitProcessOnClose: false,
      injectGlobals: true,
    }

    if (geometry && !geometry.isMaximized) {
      options.x = geometry.x
      options.y = geometry.y
    } else if (!geometry) {
      options.center = true
    }

    ;(neuWindow.create(url, options as Parameters<typeof neuWindow.create>[1]) as Promise<{ pid?: number }>).then((result) => {
      if (result?.pid) childPids.push(result.pid)
    }).catch((err) => {
      console.error('Failed to create window:', err)
    })
  } else {
    window.open(`${window.location.origin}/?window=${id}`, '_blank')
  }
}
```

Note: when `isMaximized` is true, we don't set `x`/`y` because the child window will maximize itself on startup (Task 3). We still pass the saved `width`/`height` so if the user un-maximizes, the window has a reasonable size.

- [ ] **Step 5: Commit**

```bash
git add src/services/windowManager.ts src/services/platform.ts
git commit -m "feat: add child window geometry persistence helpers"
```

---

### Task 3: Wire geometry persistence into App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update imports**

In `src/App.tsx`, update the `windowManager` import to include the new functions:

```typescript
import { loadLayout, loadGeometry, getChildWindowIds, removeLayout, startGeometryPersistence, stopGeometryPersistence } from '@/services/windowManager'
```

Also add the Neutralino window import for child maximize-on-startup:

```typescript
import { window as neuWindow } from '@neutralinojs/lib'
import { isNeutralino } from '@/services/platform'
```

- [ ] **Step 2: Start geometry persistence for child windows and restore on maximize**

In the async IIFE inside `useEffect`, after `startLayoutPersistence(windowId)`, add geometry persistence for child windows:

```typescript
      // Start auto-persisting geometry for child windows
      if (!isMain) {
        startGeometryPersistence(windowId)

        // Restore maximized state if needed
        if (isNeutralino()) {
          const geo = await loadGeometry(windowId)
          if (cancelled) return
          if (geo?.isMaximized) {
            neuWindow.maximize().catch(() => {})
          }
        }
      }
```

- [ ] **Step 3: Load geometry when restoring child windows**

In the same async IIFE, replace the child window restoration block:

```typescript
      // Restore child windows from previous session (main only)
      // A layout file existing = window should be restored
      if (isMain) {
        const childIds = await getChildWindowIds()
        if (cancelled) return
        for (const id of childIds) {
          const geo = await loadGeometry(id)
          createWindow(id, geo)
        }
      }
```

- [ ] **Step 4: Stop geometry persistence on close**

In the `onWindowClose` callback, add `stopGeometryPersistence()` next to `stopLayoutPersistence()`:

```typescript
    const unsubClose = onWindowClose(() => {
      stopLayoutPersistence()
      stopGeometryPersistence()
      if (!isMain) {
        // User explicitly closed this child — remove layout so it doesn't restore
        removeLayout(windowId)
      }
      if (isMain) {
        killChildWindows()
      }
      closeChannel()
      closeWindow()
    })
```

Also add it to the cleanup return:

```typescript
    return () => {
      cancelled = true
      unsubMessage?.()
      unsubClose()
      stopLayoutPersistence()
      stopGeometryPersistence()
    }
```

- [ ] **Step 5: Verify**

Run the app. Open a child window. Move it to a specific position and resize it. Close the app (main window). Reopen. Confirm child window restores at the same position and size.

Test maximized: maximize the child window, close the app, reopen. Confirm the child window opens maximized.

Test explicit child close: open a child, move it, close just the child (not the main window), reopen. Confirm the child does NOT reappear.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: restore child window position, size, and maximized state"
```

---

### Task 4: Add browser session persistence

**Files:**
- Modify: `src/services/windowManager.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add session save/load functions to `windowManager.ts`**

In `src/services/windowManager.ts`, add the type and functions:

```typescript
export interface PersistedSession {
  rootPath: string
  currentPath: string
  viewMode: 'directory' | 'file'
}

export function saveSession(session: PersistedSession): void {
  fileWrite('session-main', JSON.stringify(session))
}

export async function loadSession(): Promise<PersistedSession | null> {
  try {
    const raw = await fileRead('session-main')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Add session auto-persistence**

In `src/services/windowManager.ts`, add at the bottom (needs an import of `useBrowserStore`):

```typescript
import { useBrowserStore } from '@/store/browser'
```

Then add:

```typescript
let sessionUnsub: (() => void) | null = null

export function startSessionPersistence(): void {
  if (sessionUnsub) sessionUnsub()

  let timer: ReturnType<typeof setTimeout> | null = null
  sessionUnsub = useBrowserStore.subscribe((state) => {
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
  if (sessionUnsub) {
    sessionUnsub()
    sessionUnsub = null
  }
}
```

- [ ] **Step 3: Wire session persistence into App.tsx**

Update the `windowManager` import in `src/App.tsx`:

```typescript
import { loadLayout, loadGeometry, loadSession, getChildWindowIds, removeLayout, startGeometryPersistence, stopGeometryPersistence, startSessionPersistence, stopSessionPersistence } from '@/services/windowManager'
```

Add the browser store import:

```typescript
import { useBrowserStore } from '@/store/browser'
```

In the async IIFE, after starting layout persistence and before the child window restoration block, add session restoration for the main window:

```typescript
      // Restore browser session (main only)
      if (isMain) {
        const session = await loadSession()
        if (cancelled) return
        if (session?.rootPath) {
          try {
            await useBrowserStore.getState().openRoot(session.rootPath)
            if (cancelled) return
            if (session.currentPath && session.currentPath !== session.rootPath) {
              await useBrowserStore.getState().navigateTo(session.currentPath, session.viewMode)
            }
          } catch {
            // Root path no longer exists on disk — skip restoration
          }
        }
        startSessionPersistence()
      }
```

- [ ] **Step 4: Stop session persistence on close**

In the `onWindowClose` callback, add `stopSessionPersistence()`:

```typescript
    const unsubClose = onWindowClose(() => {
      stopLayoutPersistence()
      stopGeometryPersistence()
      stopSessionPersistence()
      if (!isMain) {
```

And in the cleanup return:

```typescript
    return () => {
      cancelled = true
      unsubMessage?.()
      unsubClose()
      stopLayoutPersistence()
      stopGeometryPersistence()
      stopSessionPersistence()
    }
```

- [ ] **Step 5: Verify**

Run the app. Open a project folder via File > Open Folder. Navigate into a subdirectory. Close the app. Reopen. Confirm the same project and path are restored.

Test with a file view: navigate into a file. Close and reopen. Confirm the file view is restored.

Test with no project: close the app without opening any project. Reopen. Confirm no errors and app starts normally.

Test deleted project: open a project, close the app, delete/rename the project folder, reopen the app. Confirm it starts normally with no project open (no crash).

- [ ] **Step 6: Commit**

```bash
git add src/services/windowManager.ts src/App.tsx
git commit -m "feat: restore opened project and navigation path across restarts"
```
