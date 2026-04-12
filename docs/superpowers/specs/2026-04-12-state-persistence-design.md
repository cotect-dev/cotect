# State Persistence System Design

A unified persistence system for cotect that supports both global and per-project state, built on the existing synced state backend for cross-window synchronization.

## Project Identity

Each opened project gets a stable ID used to namespace per-project state:

```
projectId = slugify(basename) + "-" + shortHash(gitRemoteUrl ?? absolutePath)
```

- `basename`: last segment of the root path (e.g. `cotect`)
- `gitRemoteUrl`: first git remote URL if available, falls back to absolute path
- `shortHash`: first 8 chars of a SHA-256 hex digest
- Example result: `cotect-a3f1b2c8`

Lives in `src/lib/projectId.ts`, computed once at app startup.

## Storage Layout

Two new JSON files managed by the synced state backend in the app-data directory:

```
app-data/
  persist-global.json
  persist-project-cotect-a3f1b2c8.json
```

Each file is a flat key-value map with keys namespaced by store name and field name:

```json
{
  "canvas.codeNodeWidth": 450,
  "canvas.hiddenNodeIds": ["src/index.ts:fn:main"]
}
```

## `withPersistence` Middleware

A Zustand middleware applied at store creation. Stores declare which fields to persist and their scope:

```typescript
export const useCanvasStore = create<CanvasState>()(
  withPersistence(
    (set, get) => ({
      codeNodeWidth: 380,
      hiddenNodeIds: new Set<string>(),
      // ...
    }),
    {
      name: 'canvas',
      fields: {
        codeNodeWidth: { scope: 'global' },
        hiddenNodeIds: { scope: 'project' },
      },
      debounce: 500,
    }
  )
)
```

### Middleware behavior

1. **On store creation** -- registers with the persistence backend, reads saved state for each declared field from the appropriate global/project file, and merges into initial state.
2. **On state change** -- subscribes via `store.subscribe()`. When a persisted field changes, debounces a write to the backend (global or project file depending on the field's scope).
3. **On project switch** -- listens for project ID changes. Flushes pending writes for the old project, loads state for the new project, merges into the store (or resets to defaults).
4. **Serialization** -- auto-converts `Set` to `Array` and `Map` to `Object` for JSON storage. Fields with custom types accept optional `serialize`/`deserialize` functions.

### Composability

The middleware is composable with existing middleware (`createStoreWithHMR`, etc.) and works with any Zustand store -- synced or not.

## Backend Integration

### New Rust commands

- `persist_get(namespace: string) -> JsonValue` -- reads a full persistence file
- `persist_set(namespace: string, key: string, value: JsonValue)` -- writes a single key and broadcasts to all windows

### Cross-window sync

When `persist_set` is called, the Rust backend writes to disk and emits a `persist-changed` event to all other windows with `{ namespace, key, value }`. The middleware listens for this event and updates the local store.

### Frontend service

`src/services/persistence.ts` -- thin wrapper over Tauri commands:

- Calls `persist_get`/`persist_set` via `invoke()`
- Listens for `persist-changed` events via `listen()`
- Caches the current project ID

The middleware talks to this service, not the IPC layer directly.

## Lifecycle

### App startup (in `useWindowLifecycle.ts`)

1. Compute project ID from root path (async -- needs git remote lookup)
2. Call `persistence.init(projectId)` which loads both global and project files
3. Each store with `withPersistence` hydrates its declared fields
4. Stores are usable immediately with defaults -- hydration overwrites once data arrives

### Project switch

1. Flush all pending debounced writes for current project
2. Compute new project ID
3. Call `persistence.switchProject(newProjectId)` which loads the new project file
4. Each middleware replaces `scope: 'project'` fields with new values or resets to defaults

### Window close

1. Flush all pending debounced writes immediately (no debounce delay)

## Extending the System

Adding new persisted state requires one change -- adding a field entry to an existing store's `withPersistence` config:

```typescript
fields: {
  codeNodeWidth: { scope: 'global' },
  hiddenNodeIds: { scope: 'project' },
  columns: { scope: 'project' },  // new
}
```

No new files, no registry updates, no backend changes.

For custom serialization:

```typescript
fields: {
  hiddenNodeIds: {
    scope: 'project',
    serialize: (set) => [...set],
    deserialize: (arr) => new Set(arr),
  },
}
```

## Initial persisted fields

| Store | Field | Scope | Notes |
|-------|-------|-------|-------|
| canvas | `codeNodeWidth` | global | Single number, user's preferred code node width |
| canvas | `hiddenNodeIds` | project | Set of node IDs hidden by the user |
