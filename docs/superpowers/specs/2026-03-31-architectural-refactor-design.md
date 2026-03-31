# Architectural Refactor Design

Preserve all current functionality (except Terminal) while restructuring the codebase bottom-up for DRY code, fewer bugs, and easier development.

## Approach

Bottom-up refactor: services → stores → components → views. Each layer stabilizes before the next one changes.

## Layer 1: Services

### New `services/storage.ts` — Unified Persistence

Replaces the duplicated `isNeutralino() ? filesystem : localStorage` pattern found in `panelState.ts`, `windowManager.ts`, and `channel.ts`.

```ts
readJson<T>(key: string): Promise<T | null>
writeJson<T>(key: string, data: T): Promise<void>
remove(key: string): Promise<void>
exists(key: string): Promise<boolean>
listKeys(prefix: string): Promise<string[]>
```

- Detects platform once at module load
- Neutralino: `/tmp/cotect-{key}.json`
- Browser: `localStorage` with `cotect-` prefix
- Errors logged via `console.warn`, return `null`/`void`
- `readJson` returns `null` on corrupt JSON (no malformed objects)

### `windowManager.ts` — Simplify

- Delete `fileRead/fileWrite/fileRemove` helpers (replaced by `storage.*`)
- `loadLayout/saveLayout/clearLayout` become one-liners
- Extract duplicated interval+unsub pattern into `createPollingPersister(key, fetchFn, intervalMs)` returning `{ start(), stop() }`
- Eliminates module-level `let geometryUnsub` / `let sessionUnsub`
- ~230 lines → ~80 lines

### `channel.ts` — Fix IPC Race Condition

Switch from shared-file-as-database to per-sender model:
- Each window writes its own file: `ipc-{senderId}.json`
- Readers poll all `ipc-*` files via `storage.listKeys('ipc-')`
- No write contention — each window only writes its own file
- Message TTL cleanup still applies
- `broadcast()` becomes async

### `treesitter.ts` — Synchronize Parser

- Guard `getParser()` with promise-based lock (deduplicate concurrent init)
- Serialize `setLanguage + parse` with a mutex to prevent concurrent interference

### Deletions

- `panelState.ts` — replaced by direct `storage.*` calls

## Layer 2: Stores

### `synced.ts` — Use Storage Layer

- Replace internal platform detection with `storage.*` calls
- `sanitize` receives validated data (post-`readJson`)
- Debounce interval becomes a parameter (default 300ms)
- Remove `isSerializable` deep-check — trust `serializableKeys` declarations

### `layout.ts` — Extract Panel Operations

Extract pure helper functions to eliminate 3x-duplicated panel removal logic:

```ts
removePanelFromState(state, panelId) → state
insertPanelIntoZone(state, panel, position, index) → state
insertGroupIntoZone(state, group, position, index) → state
findPanelLocation(state, panelId) → { position, groupIndex, panelIndex } | null
```

`movePanel`, `movePanelToTab`, `removePanel`, `moveGroup` become 3-5 line compositions.

Replace manual triple-map `cloneState()` with generic deep clone.

~340 lines → ~200 lines.

### `browser.ts` — Extract File Resolution

- `resolveImportCandidates(basePath): string[]` — deduplicate candidate list construction
- Split `generateNodes()` into `generateDirectoryNodes()` and `generateFileNodes()` — pure functions returning `{ nodes, edges }`

### `chat.ts` — Decompose sendMessage

Split 187-line `sendMessage()` into:
- `buildRequestPayload(messages, model)` — constructs fetch body
- `parseStreamChunk(line, accumulator)` — handles `<think>` tag parsing
- `sendMessage()` — orchestrates, ~40 lines
- `countWords(text)` helper — replaces repeated `.split(/\s+/).filter(Boolean).length`

### Deletions

- `terminal.ts` — deleted (Terminal feature removed)

## Layer 3: Components

### `Canvas/nodes/BaseNode.tsx` — Shared Node Component

Extract shared wrapper from FileNode, FolderNode, ClassNode, FunctionNode:

```ts
BaseNode({ icon, label, borderColor?, badge?, onClick?, children? })
```

Each variant becomes ~5 lines wrapping BaseNode.

~240 lines across 4 files → ~60 line BaseNode + 4 x 5-line variants.

### Shared Hooks

**`useScrollToBottom(dep)`** — extracted from Chat and Console. Uses RAF debouncing. Returns `{ containerRef, bottomRef }`.

**`usePanelDrag` split into 3 hooks:**
- `useDragState()` — drag active/inactive, panel ID, isGroup
- `useDragCollision()` — collision detection, insert index
- `useTabIntoDetection()` — geometry for tab-into targets

### `lib/panelGeometry.ts` — Shared Geometry

Extract `computeInsertIndex(zones, pointerPosition, orientation)` used by both `usePanelDrag` and `CrossWindowDropOverlay`.

### `DropZone.tsx` + `ResizeHandle.tsx` — Fix Memoization

- `makeResizeHandler` wrapped in `useCallback` with `[leftKey, rightKey]` deps
- `ResizeHandle` wrapped in `React.memo`
- `ResizeHandle.tsx`: replace `useCallback([props])` with destructured property deps

### `lib/constants.ts` — Layout Constants

```ts
MIN_SIDE_ZONE = 120
MIN_BOTTOM_ZONE = 80
TAB_INTO_HEIGHT = 32
NODE_WIDTH = 200
NODE_HEIGHT = 60
```

### Type Safety

Remove `[key: string]: unknown` from all node data interfaces in `types/nodes.ts`.

### Deletions

- `Terminal/` component directory deleted
- `xterm.js` + `@xterm/addon-fit` dependencies removed

## Layer 4: Views & App

### `useWindowLifecycle(windowId)` Hook

Replaces the 120+ line monolithic useEffect in App.tsx. Separate effects for:
- Channel init + window constraints
- Geometry persistence start/stop
- Layout persistence start/stop
- Session restore (main only)
- Close handler registration

Each effect has its own cleanup. Eliminates double-cleanup bug.

Returns `{ isMain, isReady }`.

App.tsx becomes ~15 lines.

### `WindowShell` Wrapper

Shared outer div for Canvas.tsx and NewWindow.tsx:
```ts
WindowShell({ children }) → dark theme wrapper div
```

### Error Handling Policy

No more `.catch(() => {})`. All services log warnings via `console.warn`. Callers that degrade gracefully do so explicitly with a comment.

## Summary

| Layer | Files Changed | Lines Saved (est.) | Key Wins |
|-------|--------------|-------------------|----------|
| services/ | 5 files | ~150 | No duplication, no race conditions |
| store/ | 5 files | ~200 | DRY panel ops, decomposed functions |
| components/ | ~12 files | ~200 | BaseNode, shared hooks, proper memoization |
| views/App | 3 files | ~130 | Single-responsibility effects |
| **Total** | **~25 files** | **~680** | Fewer bugs, easier to extend |

## Deletions

- `services/panelState.ts`
- `store/terminal.ts`
- `components/Terminal/index.tsx`
- `xterm.js` + `@xterm/addon-fit` dependencies
- Terminal removed from panel registry (layout store's panel type enum/list)
- `console.ts` store is retained — it powers the Debug Console panel, not Terminal
