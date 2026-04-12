# State Persistence System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified state persistence system with global and per-project scopes, built on the existing synced state backend, using a composable Zustand middleware.

**Architecture:** A `withPersistence` Zustand middleware subscribes to store changes, debounces writes, and hydrates state on init. It uses the existing synced state backend (Rust `SyncedStateStore` + IPC broadcast) for storage and cross-window sync. A project ID utility computes stable per-project keys from the directory basename + git remote hash.

**Tech Stack:** TypeScript, Zustand 5, Tauri IPC (`invoke`/`listen`), Rust (synced_state.rs), Vitest

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/lib/projectId.ts` | Compute stable project ID from path + git remote |
| Create | `src/lib/projectId.test.ts` | Tests for project ID computation |
| Create | `src/store/persistence.ts` | `withPersistence` middleware + persistence service |
| Create | `src/store/persistence.test.ts` | Tests for the middleware and service |
| Modify | `tauri/src/git.rs` | Add `git_remote_url` command |
| Modify | `tauri/src/main.rs:66-92` | Register `git_remote_url` in invoke handler |
| Modify | `src/store/canvas.ts:45-94,257-585` | Add `codeNodeWidth` field, wrap with `withPersistence` |
| Modify | `src/components/Canvas/nodes/CodeNode.tsx:32-70` | Read/write `codeNodeWidth` from canvas store |
| Modify | `src/hooks/useWindowLifecycle.ts:10-172` | Init persistence on startup, handle project switch |

---

### Task 1: Add `git_remote_url` Tauri Command

**Files:**
- Modify: `tauri/src/git.rs`
- Modify: `tauri/src/main.rs:66-92`

- [ ] **Step 1: Write the Rust command**

Add to the end of `tauri/src/git.rs` (before any `#[cfg(test)]` block if present):

```rust
#[tauri::command]
pub async fn git_remote_url(repo_path: String) -> Result<Option<String>, String> {
    match run_git(&repo_path, &["remote", "get-url", "origin"]).await {
        Ok(url) => Ok(Some(url.trim().to_string())),
        Err(_) => Ok(None),
    }
}
```

- [ ] **Step 2: Register the command in main.rs**

In `tauri/src/main.rs`, add `git::git_remote_url` to the `invoke_handler` list (after `git::git_last_commit_time`):

```rust
            git::git_last_commit_time,
            git::git_remote_url,
```

- [ ] **Step 3: Verify Rust compiles**

Run: `cd /Users/server/cotect/tauri && cargo check 2>&1 | tail -5`
Expected: `Finished` with no errors

- [ ] **Step 4: Commit**

```bash
git add tauri/src/git.rs tauri/src/main.rs
git commit -m "feat: add git_remote_url Tauri command for project ID computation"
```

---

### Task 2: Create Project ID Utility

**Files:**
- Create: `src/lib/projectId.ts`
- Create: `src/lib/projectId.test.ts`

- [ ] **Step 1: Write the test file**

Create `src/lib/projectId.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'

// Mock tauri invoke - must be before import
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { computeProjectId, slugify, shortHash } from './projectId'
import { invoke } from '@tauri-apps/api/core'

const mockedInvoke = vi.mocked(invoke)

describe('slugify', () => {
  it('lowercases and replaces non-alphanumeric with hyphens', () => {
    expect(slugify('My Project')).toBe('my-project')
  })

  it('trims leading/trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello')
  })

  it('collapses consecutive hyphens', () => {
    expect(slugify('a   b___c')).toBe('a-b-c')
  })
})

describe('shortHash', () => {
  it('returns an 8 character hex string', async () => {
    const hash = await shortHash('https://github.com/user/repo.git')
    expect(hash).toMatch(/^[a-f0-9]{8}$/)
  })

  it('returns the same hash for the same input', async () => {
    const a = await shortHash('test')
    const b = await shortHash('test')
    expect(a).toBe(b)
  })

  it('returns different hashes for different inputs', async () => {
    const a = await shortHash('foo')
    const b = await shortHash('bar')
    expect(a).not.toBe(b)
  })
})

describe('computeProjectId', () => {
  it('uses git remote URL when available', async () => {
    mockedInvoke.mockResolvedValueOnce('https://github.com/user/repo.git')
    const id = await computeProjectId('/home/user/repo')
    expect(id).toMatch(/^repo-[a-f0-9]{8}$/)
  })

  it('falls back to absolute path when git remote fails', async () => {
    mockedInvoke.mockRejectedValueOnce(new Error('not a git repo'))
    const id = await computeProjectId('/home/user/my-project')
    expect(id).toMatch(/^my-project-[a-f0-9]{8}$/)
  })

  it('falls back to absolute path when remote returns null', async () => {
    mockedInvoke.mockResolvedValueOnce(null)
    const id = await computeProjectId('/home/user/project')
    expect(id).toMatch(/^project-[a-f0-9]{8}$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/server/cotect && npx vitest run src/lib/projectId.test.ts 2>&1 | tail -15`
Expected: FAIL — module `./projectId` not found

- [ ] **Step 3: Write the implementation**

Create `src/lib/projectId.ts`:

```typescript
import { invoke } from '@tauri-apps/api/core'

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function shortHash(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  return hashHex.slice(0, 8)
}

async function getGitRemoteUrl(repoPath: string): Promise<string | null> {
  try {
    const url = await invoke<string | null>('git_remote_url', { repoPath })
    return url || null
  } catch {
    return null
  }
}

export async function computeProjectId(rootPath: string): Promise<string> {
  const basename = rootPath.split('/').filter(Boolean).pop() || 'project'
  const slug = slugify(basename)

  const remoteUrl = await getGitRemoteUrl(rootPath)
  const hashInput = remoteUrl ?? rootPath
  const hash = await shortHash(hashInput)

  return `${slug}-${hash}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/server/cotect && npx vitest run src/lib/projectId.test.ts 2>&1 | tail -15`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/projectId.ts src/lib/projectId.test.ts
git commit -m "feat: add project ID utility for per-project state scoping"
```

---

### Task 3: Create Persistence Middleware and Service

**Files:**
- Create: `src/store/persistence.ts`
- Create: `src/store/persistence.test.ts`

- [ ] **Step 1: Write the test file**

Create `src/store/persistence.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { create } from 'zustand'

// Mock platform
const mockSyncedSet = vi.fn()
const mockSyncedGet = vi.fn().mockResolvedValue(null)
const mockSyncedListen = vi.fn().mockReturnValue(() => {})
const mockGetWindowId = vi.fn().mockReturnValue('test-window')

vi.mock('@/services/platform', () => ({
  getPlatform: () => ({
    windows: { getWindowId: mockGetWindowId },
    syncedState: {
      set: mockSyncedSet,
      get: mockSyncedGet,
      listen: mockSyncedListen,
    },
  }),
}))

// Mock projectId
vi.mock('@/lib/projectId', () => ({
  computeProjectId: vi.fn().mockResolvedValue('test-project-abc12345'),
}))

import {
  withPersistence,
  initPersistence,
  stopPersistence,
  switchProject,
  flushPendingWrites,
  _testReset,
} from './persistence'

describe('persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    _testReset()
    mockSyncedGet.mockResolvedValue(null)
  })

  afterEach(() => {
    stopPersistence()
    vi.useRealTimers()
  })

  describe('withPersistence middleware', () => {
    it('creates a working store with initial state', () => {
      const store = create(
        withPersistence<{ count: number; inc: () => void }>(
          (set) => ({
            count: 0,
            inc: () => set((s) => ({ count: s.count + 1 })),
          }),
          { name: 'test', fields: { count: { scope: 'global' } }, debounce: 100 },
        ),
      )

      expect(store.getState().count).toBe(0)
      store.getState().inc()
      expect(store.getState().count).toBe(1)
    })
  })

  describe('initPersistence', () => {
    it('loads saved global state and hydrates the store', async () => {
      mockSyncedGet.mockImplementation((name: string) => {
        if (name === 'persist:global') return Promise.resolve({ 'mystore.width': 500 })
        return Promise.resolve(null)
      })

      const store = create(
        withPersistence<{ width: number }>(
          () => ({ width: 300 }),
          { name: 'mystore', fields: { width: { scope: 'global' } }, debounce: 100 },
        ),
      )

      await initPersistence('test-project-abc12345')

      expect(store.getState().width).toBe(500)
    })

    it('loads saved project state and hydrates the store', async () => {
      mockSyncedGet.mockImplementation((name: string) => {
        if (name === 'persist:project:test-project-abc12345') {
          return Promise.resolve({ 'mystore.items': ['a', 'b'] })
        }
        return Promise.resolve(null)
      })

      const store = create(
        withPersistence<{ items: string[] }>(
          () => ({ items: [] }),
          { name: 'mystore', fields: { items: { scope: 'project' } }, debounce: 100 },
        ),
      )

      await initPersistence('test-project-abc12345')

      expect(store.getState().items).toEqual(['a', 'b'])
    })

    it('uses deserialize function when provided', async () => {
      mockSyncedGet.mockImplementation((name: string) => {
        if (name === 'persist:project:test-project-abc12345') {
          return Promise.resolve({ 'mystore.ids': ['x', 'y'] })
        }
        return Promise.resolve(null)
      })

      const store = create(
        withPersistence<{ ids: Set<string> }>(
          () => ({ ids: new Set() }),
          {
            name: 'mystore',
            fields: {
              ids: {
                scope: 'project',
                serialize: (s: Set<string>) => [...s],
                deserialize: (arr: unknown) => new Set(arr as string[]),
              },
            },
            debounce: 100,
          },
        ),
      )

      await initPersistence('test-project-abc12345')

      expect(store.getState().ids).toBeInstanceOf(Set)
      expect(store.getState().ids.has('x')).toBe(true)
      expect(store.getState().ids.has('y')).toBe(true)
    })
  })

  describe('debounced writes', () => {
    it('writes global field changes after debounce', async () => {
      const store = create(
        withPersistence<{ width: number }>(
          (set) => ({ width: 300 }),
          { name: 'mystore', fields: { width: { scope: 'global' } }, debounce: 100 },
        ),
      )

      await initPersistence('test-project-abc12345')
      mockSyncedSet.mockClear()

      store.setState({ width: 500 })

      // Not written yet (debounced)
      expect(mockSyncedSet).not.toHaveBeenCalled()

      // Advance past debounce
      vi.advanceTimersByTime(150)

      expect(mockSyncedSet).toHaveBeenCalledWith(
        'persist:global',
        expect.objectContaining({ 'mystore.width': 500 }),
        'test-window',
      )
    })

    it('writes project field changes to the project namespace', async () => {
      const store = create(
        withPersistence<{ hidden: string[] }>(
          (set) => ({ hidden: [] }),
          { name: 'mystore', fields: { hidden: { scope: 'project' } }, debounce: 100 },
        ),
      )

      await initPersistence('test-project-abc12345')
      mockSyncedSet.mockClear()

      store.setState({ hidden: ['node-1'] })
      vi.advanceTimersByTime(150)

      expect(mockSyncedSet).toHaveBeenCalledWith(
        'persist:project:test-project-abc12345',
        expect.objectContaining({ 'mystore.hidden': ['node-1'] }),
        'test-window',
      )
    })

    it('uses serialize function when provided', async () => {
      const store = create(
        withPersistence<{ ids: Set<string> }>(
          () => ({ ids: new Set() }),
          {
            name: 'mystore',
            fields: {
              ids: {
                scope: 'global',
                serialize: (s: Set<string>) => [...s],
                deserialize: (arr: unknown) => new Set(arr as string[]),
              },
            },
            debounce: 100,
          },
        ),
      )

      await initPersistence('test-project-abc12345')
      mockSyncedSet.mockClear()

      store.setState({ ids: new Set(['a', 'b']) })
      vi.advanceTimersByTime(150)

      expect(mockSyncedSet).toHaveBeenCalledWith(
        'persist:global',
        expect.objectContaining({ 'mystore.ids': ['a', 'b'] }),
        'test-window',
      )
    })
  })

  describe('flushPendingWrites', () => {
    it('writes immediately without waiting for debounce', async () => {
      const store = create(
        withPersistence<{ val: number }>(
          () => ({ val: 0 }),
          { name: 'mystore', fields: { val: { scope: 'global' } }, debounce: 5000 },
        ),
      )

      await initPersistence('test-project-abc12345')
      mockSyncedSet.mockClear()

      store.setState({ val: 42 })
      flushPendingWrites()

      expect(mockSyncedSet).toHaveBeenCalledWith(
        'persist:global',
        expect.objectContaining({ 'mystore.val': 42 }),
        'test-window',
      )
    })
  })

  describe('switchProject', () => {
    it('flushes writes and loads new project state', async () => {
      const store = create(
        withPersistence<{ items: string[] }>(
          () => ({ items: [] }),
          { name: 'mystore', fields: { items: { scope: 'project' } }, debounce: 100 },
        ),
      )

      await initPersistence('project-a')

      mockSyncedGet.mockImplementation((name: string) => {
        if (name === 'persist:project:project-b') {
          return Promise.resolve({ 'mystore.items': ['from-b'] })
        }
        return Promise.resolve(null)
      })

      await switchProject('project-b')

      expect(store.getState().items).toEqual(['from-b'])
    })

    it('resets project fields to defaults when no saved state exists', async () => {
      const store = create(
        withPersistence<{ items: string[] }>(
          () => ({ items: ['default'] }),
          { name: 'mystore', fields: { items: { scope: 'project' } }, debounce: 100 },
        ),
      )

      await initPersistence('project-a')
      store.setState({ items: ['modified'] })

      mockSyncedGet.mockResolvedValue(null)

      await switchProject('project-b')

      expect(store.getState().items).toEqual(['default'])
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/server/cotect && npx vitest run src/store/persistence.test.ts 2>&1 | tail -15`
Expected: FAIL — module `./persistence` not found

- [ ] **Step 3: Write the implementation**

Create `src/store/persistence.ts`:

```typescript
import type { StateCreator, StoreApi } from 'zustand'
import { getPlatform } from '@/services/platform'

// --- Types ---

interface PersistFieldConfig<V = unknown> {
  scope: 'global' | 'project'
  serialize?: (value: V) => unknown
  deserialize?: (raw: unknown) => V
}

interface PersistOptions<T> {
  name: string
  fields: { [K in keyof T]?: PersistFieldConfig<T[K]> }
  debounce?: number
}

interface RegisteredStore {
  name: string
  store: StoreApi<unknown>
  fields: Record<string, PersistFieldConfig>
  defaults: Record<string, unknown>
  debounce: number
  unsubscribe: (() => void) | null
}

// --- Module state ---

const registeredStores: RegisteredStore[] = []
let currentProjectId: string | null = null
let globalCache: Record<string, unknown> = {}
let projectCache: Record<string, unknown> = {}
let initialized = false
let unlisteners: (() => void)[] = []

// Debounce timers: one per namespace ('global' | 'project')
const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {}
// Pending writes: accumulated key-value pairs per namespace
const pendingGlobal: Record<string, unknown> = {}
const pendingProject: Record<string, unknown> = {}

// --- Middleware ---

export function withPersistence<T>(
  creator: StateCreator<T, [], []>,
  options: PersistOptions<T>,
): StateCreator<T, [], []> {
  return (set, get, api) => {
    const initialState = creator(set, get, api)

    // Capture default values for project-scoped fields (used on project switch when no saved state)
    const defaults: Record<string, unknown> = {}
    for (const [field] of Object.entries(options.fields)) {
      defaults[field] = (initialState as Record<string, unknown>)[field]
    }

    registeredStores.push({
      name: options.name,
      store: api as unknown as StoreApi<unknown>,
      fields: options.fields as Record<string, PersistFieldConfig>,
      defaults,
      debounce: options.debounce ?? 500,
      unsubscribe: null,
    })

    return initialState
  }
}

// --- Persistence service ---

function getNamespace(scope: 'global' | 'project'): string {
  if (scope === 'global') return 'persist:global'
  return `persist:project:${currentProjectId}`
}

function serializeField(config: PersistFieldConfig, value: unknown): unknown {
  if (config.serialize) return config.serialize(value)
  // Auto-convert Set and Map
  if (value instanceof Set) return [...value]
  if (value instanceof Map) return Object.fromEntries(value)
  return value
}

function deserializeField(config: PersistFieldConfig, raw: unknown): unknown {
  if (config.deserialize) return config.deserialize(raw)
  return raw
}

function scheduleWrite(scope: 'global' | 'project', debounceMs: number) {
  const timerKey = scope
  if (debounceTimers[timerKey]) clearTimeout(debounceTimers[timerKey])

  debounceTimers[timerKey] = setTimeout(() => {
    flushScope(scope)
  }, debounceMs)
}

function flushScope(scope: 'global' | 'project') {
  const pending = scope === 'global' ? pendingGlobal : pendingProject
  const cache = scope === 'global' ? globalCache : projectCache

  if (Object.keys(pending).length === 0) return

  // Merge pending into cache
  for (const [key, value] of Object.entries(pending)) {
    cache[key] = value
  }

  // Clear pending
  for (const key of Object.keys(pending)) {
    delete pending[key]
  }

  // Clear any pending timer
  if (debounceTimers[scope]) {
    clearTimeout(debounceTimers[scope])
    delete debounceTimers[scope]
  }

  // Write to backend
  const platform = getPlatform()
  const windowId = platform.windows.getWindowId()
  const namespace = getNamespace(scope)
  platform.syncedState.set(namespace, { ...cache }, windowId)
}

function startStoreSubscriptions() {
  for (const entry of registeredStores) {
    if (entry.unsubscribe) continue

    let prevState = entry.store.getState() as Record<string, unknown>

    entry.unsubscribe = entry.store.subscribe(() => {
      if (!initialized) return

      const state = entry.store.getState() as Record<string, unknown>

      for (const [field, config] of Object.entries(entry.fields)) {
        if (state[field] !== prevState[field]) {
          const key = `${entry.name}.${field}`
          const serialized = serializeField(config, state[field])

          if (config.scope === 'global') {
            pendingGlobal[key] = serialized
          } else {
            pendingProject[key] = serialized
          }

          scheduleWrite(config.scope, entry.debounce)
        }
      }

      prevState = state
    })
  }
}

function hydrateStores(
  globalData: Record<string, unknown> | null,
  projectData: Record<string, unknown> | null,
) {
  globalCache = globalData && typeof globalData === 'object' ? { ...globalData } : {}
  projectCache = projectData && typeof projectData === 'object' ? { ...projectData } : {}

  for (const entry of registeredStores) {
    const patch: Record<string, unknown> = {}

    for (const [field, config] of Object.entries(entry.fields)) {
      const key = `${entry.name}.${field}`
      const source = config.scope === 'global' ? globalCache : projectCache

      if (key in source) {
        patch[field] = deserializeField(config, source[key])
      }
    }

    if (Object.keys(patch).length > 0) {
      entry.store.setState(patch)
    }
  }
}

function startCrossWindowSync() {
  const platform = getPlatform()
  const windowId = platform.windows.getWindowId()

  // Listen for global persistence changes
  const unlistenGlobal = platform.syncedState.listen('persist:global', ({ state, source }) => {
    if (source === windowId || !state || typeof state !== 'object') return
    globalCache = { ...(state as Record<string, unknown>) }
    hydrateFromCache('global')
  })
  unlisteners.push(unlistenGlobal)

  // Listen for current project persistence changes
  if (currentProjectId) {
    const ns = `persist:project:${currentProjectId}`
    const unlistenProject = platform.syncedState.listen(ns, ({ state, source }) => {
      if (source === windowId || !state || typeof state !== 'object') return
      projectCache = { ...(state as Record<string, unknown>) }
      hydrateFromCache('project')
    })
    unlisteners.push(unlistenProject)
  }
}

function hydrateFromCache(scope: 'global' | 'project') {
  const cache = scope === 'global' ? globalCache : projectCache

  for (const entry of registeredStores) {
    const patch: Record<string, unknown> = {}

    for (const [field, config] of Object.entries(entry.fields)) {
      if (config.scope !== scope) continue
      const key = `${entry.name}.${field}`
      if (key in cache) {
        patch[field] = deserializeField(config, cache[key])
      }
    }

    if (Object.keys(patch).length > 0) {
      entry.store.setState(patch)
    }
  }
}

// --- Public API ---

export async function initPersistence(projectId: string): Promise<void> {
  currentProjectId = projectId
  const platform = getPlatform()

  const [globalData, projectData] = await Promise.all([
    platform.syncedState.get('persist:global'),
    platform.syncedState.get(`persist:project:${projectId}`),
  ])

  hydrateStores(
    globalData as Record<string, unknown> | null,
    projectData as Record<string, unknown> | null,
  )

  startStoreSubscriptions()
  startCrossWindowSync()
  initialized = true
}

export async function switchProject(newProjectId: string): Promise<void> {
  // Flush pending writes for old project
  flushScope('project')

  // Stop old project listener
  for (const unlisten of unlisteners) {
    unlisten()
  }
  unlisteners = []

  currentProjectId = newProjectId

  // Load new project data
  const platform = getPlatform()
  const projectData = await platform.syncedState.get(`persist:project:${newProjectId}`)

  // Reset project-scoped fields to defaults, then apply saved state
  for (const entry of registeredStores) {
    const patch: Record<string, unknown> = {}
    for (const [field, config] of Object.entries(entry.fields)) {
      if (config.scope !== 'project') continue
      patch[field] = entry.defaults[field]
    }
    if (Object.keys(patch).length > 0) {
      entry.store.setState(patch)
    }
  }

  if (projectData && typeof projectData === 'object') {
    projectCache = { ...(projectData as Record<string, unknown>) }
    hydrateFromCache('project')
  } else {
    projectCache = {}
  }

  // Restart cross-window sync with new project namespace
  startCrossWindowSync()
}

export function flushPendingWrites(): void {
  flushScope('global')
  flushScope('project')
}

export function stopPersistence(): void {
  flushPendingWrites()

  for (const entry of registeredStores) {
    entry.unsubscribe?.()
    entry.unsubscribe = null
  }

  for (const unlisten of unlisteners) {
    unlisten()
  }
  unlisteners = []

  for (const key of Object.keys(debounceTimers)) {
    clearTimeout(debounceTimers[key])
    delete debounceTimers[key]
  }

  initialized = false
}

/** Reset all module state. Only for tests. */
export function _testReset(): void {
  stopPersistence()
  registeredStores.length = 0
  globalCache = {}
  projectCache = {}
  currentProjectId = null
  for (const key of Object.keys(pendingGlobal)) delete pendingGlobal[key]
  for (const key of Object.keys(pendingProject)) delete pendingProject[key]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/server/cotect && npx vitest run src/store/persistence.test.ts 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/persistence.ts src/store/persistence.test.ts
git commit -m "feat: add withPersistence Zustand middleware and persistence service"
```

---

### Task 4: Add `codeNodeWidth` to Canvas Store and Apply Persistence

**Files:**
- Modify: `src/store/canvas.ts:45-94,257-585`

- [ ] **Step 1: Add `codeNodeWidth` field and `setCodeNodeWidth` action to the type**

In `src/store/canvas.ts`, add to the `CanvasState` type (after `hiddenNodeIds` on line 66):

```typescript
  // Persisted width for code nodes (global preference)
  codeNodeWidth: number
```

And add an action (after `toggleHideNode` on line 91):

```typescript
  /** Set the width for all code nodes (persisted globally). */
  setCodeNodeWidth: (width: number) => void
```

- [ ] **Step 2: Add initial state and action implementation**

In the store creator (after `hiddenNodeIds: new Set(),` on line 265), add:

```typescript
  codeNodeWidth: 650,
```

After the `toggleHideNode` implementation (after line 516), add:

```typescript
  setCodeNodeWidth: (width: number) => {
    set({ codeNodeWidth: width })
  },
```

- [ ] **Step 3: Wrap with `withPersistence`**

Change the store creation at line 257. Replace:

```typescript
export const useCanvasStore = createStoreWithHMR(import.meta.hot, 'canvas', () => create<CanvasState>((set, get) => ({
```

With:

```typescript
import { withPersistence } from '@/store/persistence'

export const useCanvasStore = createStoreWithHMR(import.meta.hot, 'canvas', () => create<CanvasState>()(
  withPersistence(
    (set, get) => ({
```

And change the closing of the store creator. Replace the closing at line 585:

```typescript
})))
```

With:

```typescript
    }),
    {
      name: 'canvas',
      fields: {
        codeNodeWidth: { scope: 'global' },
        hiddenNodeIds: {
          scope: 'project',
          serialize: (s: Set<string>) => [...s],
          deserialize: (raw: unknown) => new Set(raw as string[]),
        },
      },
      debounce: 500,
    },
  ),
))
```

Also add the import at the top of the file:

```typescript
import { withPersistence } from '@/store/persistence'
```

- [ ] **Step 4: Run existing canvas tests to ensure no regressions**

Run: `cd /Users/server/cotect && npx vitest run src/store/canvas.test.ts 2>&1 | tail -15`
Expected: All existing tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/canvas.ts
git commit -m "feat: add codeNodeWidth to canvas store, wrap with withPersistence"
```

---

### Task 5: Update CodeNode Component to Use Store Width

**Files:**
- Modify: `src/components/Canvas/nodes/CodeNode.tsx:32-70`

- [ ] **Step 1: Replace local width state with store-backed state**

In `CodeNode.tsx`, add the import for the canvas store at the top (after the existing imports):

```typescript
import { useCanvasStore } from '@/store/canvas'
```

- [ ] **Step 2: Replace the local state and resize handler**

Replace the `DEFAULT_CODE_NODE_WIDTH` constant and the component's width state (lines 23-24 and 39):

Remove line 23-24:
```typescript
const DEFAULT_CODE_NODE_WIDTH = 650
const MIN_CODE_NODE_WIDTH = 280
```

Replace with just the min constant:
```typescript
const MIN_CODE_NODE_WIDTH = 280
```

Inside the component, replace line 39:
```typescript
  const [nodeWidth, setNodeWidth] = useState<number>(DEFAULT_CODE_NODE_WIDTH)
```

With:
```typescript
  const storeWidth = useCanvasStore((s) => s.codeNodeWidth)
  const setCodeNodeWidth = useCanvasStore((s) => s.setCodeNodeWidth)
  const [nodeWidth, setNodeWidth] = useState<number>(storeWidth)

  // Sync from store when it changes externally (e.g. cross-window sync, hydration)
  useEffect(() => {
    setNodeWidth(storeWidth)
  }, [storeWidth])
```

- [ ] **Step 3: Update the resize handler to commit to store on mouseup**

Replace the `onUp` callback inside `handleResizeMouseDown` (lines 58-63):

```typescript
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
```

With:

```typescript
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      // Commit final width to store (persisted + synced to other windows)
      const finalWidth = Math.max(MIN_CODE_NODE_WIDTH, startWidth + (ev.clientX - startX))
      setCodeNodeWidth(finalWidth)
    }
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /Users/server/cotect && npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/Canvas/nodes/CodeNode.tsx
git commit -m "feat: code node width reads from canvas store, persisted globally"
```

---

### Task 6: Wire Persistence into Window Lifecycle

**Files:**
- Modify: `src/hooks/useWindowLifecycle.ts:1-172`

- [ ] **Step 1: Add persistence imports**

Add to the imports at the top of `useWindowLifecycle.ts`:

```typescript
import { initPersistence, stopPersistence, flushPendingWrites, switchProject } from '@/store/persistence'
import { computeProjectId } from '@/lib/projectId'
```

- [ ] **Step 2: Initialize persistence after synced stores**

In the first `useEffect` (lines 16-22), add persistence init after `initAllSyncedStores()`. Replace:

```typescript
  useEffect(() => {
    void platform.windows.setMinSize(isMain ? 1280 : 400, isMain ? 720 : 300)
    if (isMain) clearAllSyncedStores()
    initAllSyncedStores()
    return () => { stopAllSyncedStores() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

With:

```typescript
  useEffect(() => {
    void platform.windows.setMinSize(isMain ? 1280 : 400, isMain ? 720 : 300)
    if (isMain) clearAllSyncedStores()
    initAllSyncedStores()
    return () => {
      stopPersistence()
      stopAllSyncedStores()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

- [ ] **Step 3: Add persistence init to the async startup**

In the second `useEffect` (the async IIFE), after `startSessionPersistence()` (line 93) and before the `useBrowserStore.subscribe(...)` block, add:

```typescript
        // Initialize persistence with the current project
        const rootPath = session?.rootPath || useBrowserStore.getState().rootPath
        if (rootPath) {
          const projectId = await computeProjectId(rootPath)
          await initPersistence(projectId)
        }
```

- [ ] **Step 4: Handle project switch in the browser store subscription**

In the `useBrowserStore.subscribe` callback (around line 95-105), add persistence switching after the git watcher restart. After `startGitWatcher(state.rootPath, windowId)`, add:

```typescript
            // Switch persistence to the new project
            computeProjectId(state.rootPath).then((newProjectId) => {
              switchProject(newProjectId).catch((err) => {
                console.warn('[windowLifecycle] persistence project switch failed:', err)
              })
            }).catch((err) => {
              console.warn('[windowLifecycle] project ID computation failed:', err)
            })
```

- [ ] **Step 5: Flush persistence on window close**

In the `onClose` effect (around line 147-160), add `flushPendingWrites()` at the beginning of the close handler:

```typescript
    return platform.windows.onClose(() => {
      flushPendingWrites()
      stopLayoutPersistence()
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd /Users/server/cotect && npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 7: Run all tests**

Run: `cd /Users/server/cotect && npx vitest run 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useWindowLifecycle.ts
git commit -m "feat: wire persistence init, project switch, and flush into window lifecycle"
```

---

### Task 7: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `cd /Users/server/cotect && npx vitest run 2>&1 | tail -30`
Expected: All tests PASS

- [ ] **Step 2: Run TypeScript type check**

Run: `cd /Users/server/cotect && npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 3: Run Rust tests**

Run: `cd /Users/server/cotect/tauri && cargo test 2>&1 | tail -15`
Expected: All tests PASS

- [ ] **Step 4: Verify dev server starts**

Run: `cd /Users/server/cotect && npx vite --host 2>&1 | head -10`
Expected: Vite dev server starts without errors
