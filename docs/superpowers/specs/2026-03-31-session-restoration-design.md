# Session Restoration Design

Restore full application state across restarts: window positions/sizes, maximized state, and the project/path the user was browsing.

## Scope

1. **Main window geometry** -- enable Neutralino's built-in `useSavedState` in `neutralino.config.json`
2. **Child window geometry** -- persist and restore position, size, and maximized state
3. **Main window browser state** -- persist and restore `rootPath`, `currentPath`, `viewMode`

## Child Window Geometry

### Storage

New file per child window: `/tmp/cotect-wm-geometry-{windowId}.json`

Uses the existing `fileWrite`/`fileRead`/`fileRemove` helpers in `windowManager.ts`.

Schema:
```json
{
  "x": 100,
  "y": 200,
  "width": 800,
  "height": 600,
  "isMaximized": false
}
```

### Saving

Each child window periodically saves its geometry via a debounced auto-save (same 300ms pattern as layout persistence). Uses Neutralino's `window.getPosition()`, `window.getSize()`, and `window.isMaximized()`.

Add `startGeometryPersistence(windowId)` and `stopGeometryPersistence()` to `windowManager.ts`, called from `App.tsx` alongside layout persistence. Only runs for non-main windows.

On explicit close (user clicks X), geometry is removed alongside layout via `removeLayout()` (which already removes `layout-{id}` and `zones-{id}` -- extend it to also remove `geometry-{id}`).

### Restoring

`createWindow(id)` in `platform.ts` gains an optional geometry parameter. When geometry is saved, pass `x`, `y`, `width`, `height` to `neuWindow.create()` options (replacing the current hardcoded 800x600 centered defaults). Remove `center: true` when geometry is provided.

If `isMaximized` was true, create the window at the saved size/position, then the child window calls `window.maximize()` on startup after detecting its own saved geometry.

### Discovery

`getChildWindowIds()` already discovers children by scanning for `cotect-wm-layout-*` files. No change needed -- geometry files are supplementary data loaded after discovery.

## Main Window Geometry

Enable `useSavedState: true` in `neutralino.config.json` under `modes.window`. Neutralino handles this natively via `.tmp/window_state.config.json` (already exists). No custom code needed.

## Main Window Browser State

### Storage

Single file: `/tmp/cotect-wm-session-main.json`

Uses the same `fileWrite`/`fileRead` helpers.

Schema:
```json
{
  "rootPath": "/home/user/projects/my-app",
  "currentPath": "/home/user/projects/my-app/src",
  "viewMode": "directory"
}
```

### Saving

Add `saveSession(state)` and `loadSession()` to `windowManager.ts`. Subscribe to `useBrowserStore` changes with debounced auto-save (300ms), similar to layout persistence. Only save when `rootPath` is non-empty (no point persisting empty state).

Start persistence in `App.tsx` after the browser store is initialized, main window only.

### Restoring

On main window startup in `App.tsx`, after loading layout, load the saved session. If a `rootPath` exists, call `openRoot(rootPath)` then `navigateTo(currentPath, viewMode)`. If the root path no longer exists on disk (folder was deleted/moved), skip restoration silently.

### Clearing

`clearAllSyncedStores()` currently clears session-scoped panel state. The browser session should NOT be cleared here -- it's meant to survive restarts. The session file is only removed if the user opens a different project (overwritten naturally by the debounced save).

## Files Changed

| File | Change |
|------|--------|
| `neutralino.config.json` | Add `useSavedState: true` to `modes.window` |
| `src/services/windowManager.ts` | Add geometry save/load/remove, session save/load, geometry persistence start/stop |
| `src/services/platform.ts` | Accept optional geometry in `createWindow()`, apply to `neuWindow.create()` options |
| `src/App.tsx` | Load+apply geometry for child windows on startup, start geometry persistence for children, load+apply browser session for main, start session persistence for main |

## Edge Cases

- **Monitor disconnected:** Child window saved at x=2000 on a second monitor that's no longer connected. The OS/window manager typically handles this by clamping to visible area. No special handling needed.
- **Root path deleted:** `openRoot` will fail to read directory. Catch the error and fall back to empty state (no project open).
- **First launch:** No session/geometry files exist. Current defaults apply (800x600 centered for children, default layout for main, no project open).
