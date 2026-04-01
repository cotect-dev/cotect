# Architectural Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Cotect's codebase bottom-up for DRY code, fewer bugs, and better maintainability while preserving all functionality except Terminal.

**Architecture:** Bottom-up refactor in 4 layers: services → stores → components → views. Each layer stabilizes before the next changes. The key structural changes are: unified persistence layer (`storage.ts`), extracted panel operation helpers, decomposed `sendMessage`, shared `BaseNode` component, and `useWindowLifecycle` hook.

**Tech Stack:** React 19, TypeScript, Zustand, NeutralinoJS, @xyflow/react, @dnd-kit, web-tree-sitter

---

### Task 1: Create Unified Storage Service

**Files:**
- Create: `src/services/storage.ts`

- [ ] **Step 1: Create `src/services/storage.ts`**

```typescript
import { filesystem } from '@neutralinojs/lib'
import { isNeutralino } from './platform'

const FILE_PREFIX = '/tmp/cotect-'
const LS_PREFIX = 'cotect:'

export async function readJson<T>(key: string): Promise<T | null> {
  try {
    if (isNeutralino()) {
      const raw = await filesystem.readFile(`${FILE_PREFIX}${key}.json`)
      return JSON.parse(raw)
    } else {
      const raw = localStorage.getItem(`${LS_PREFIX}${key}`)
      return raw ? JSON.parse(raw) : null
    }
  } catch {
    console.warn(`[storage] Failed to read key "${key}"`)
    return null
  }
}

export async function writeJson<T>(key: string, data: T): Promise<void> {
  const json = JSON.stringify(data)
  try {
    if (isNeutralino()) {
      await filesystem.writeFile(`${FILE_PREFIX}${key}.json`, json)
    } else {
      localStorage.setItem(`${LS_PREFIX}${key}`, json)
    }
  } catch {
    console.warn(`[storage] Failed to write key "${key}"`)
  }
}

export function writeJsonSync<T>(key: string, data: T): void {
  const json = JSON.stringify(data)
  if (isNeutralino()) {
    filesystem.writeFile(`${FILE_PREFIX}${key}.json`, json).catch(() => {
      console.warn(`[storage] Failed to write key "${key}"`)
    })
  } else {
    try {
      localStorage.setItem(`${LS_PREFIX}${key}`, json)
    } catch {
      console.warn(`[storage] Failed to write key "${key}"`)
    }
  }
}

export async function remove(key: string): Promise<void> {
  try {
    if (isNeutralino()) {
      await filesystem.remove(`${FILE_PREFIX}${key}.json`)
    } else {
      localStorage.removeItem(`${LS_PREFIX}${key}`)
    }
  } catch {
    console.warn(`[storage] Failed to remove key "${key}"`)
  }
}

export function removeSync(key: string): void {
  if (isNeutralino()) {
    filesystem.remove(`${FILE_PREFIX}${key}.json`).catch(() => {
      console.warn(`[storage] Failed to remove key "${key}"`)
    })
  } else {
    try {
      localStorage.removeItem(`${LS_PREFIX}${key}`)
    } catch {
      console.warn(`[storage] Failed to remove key "${key}"`)
    }
  }
}

export async function exists(key: string): Promise<boolean> {
  try {
    if (isNeutralino()) {
      await filesystem.readFile(`${FILE_PREFIX}${key}.json`)
      return true
    } else {
      return localStorage.getItem(`${LS_PREFIX}${key}`) !== null
    }
  } catch {
    return false
  }
}

export async function listKeys(prefix: string): Promise<string[]> {
  if (isNeutralino()) {
    try {
      const entries = await filesystem.readDirectory('/tmp')
      const fullPrefix = `cotect-${prefix}`
      const keys: string[] = []
      for (const entry of entries) {
        if (entry.type === 'FILE' && entry.entry.startsWith(fullPrefix) && entry.entry.endsWith('.json')) {
          keys.push(entry.entry.slice('cotect-'.length, -5))
        }
      }
      return keys
    } catch {
      return []
    }
  } else {
    const keys: string[] = []
    const fullPrefix = `${LS_PREFIX}${prefix}`
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(fullPrefix)) {
        keys.push(key.slice(LS_PREFIX.length))
      }
    }
    return keys
  }
}
```

- [ ] **Step 2: Verify the app still builds**

Run: `cd /home/grzracz/dev/cotect && npx tsc --noEmit`
Expected: No new errors (file is unused so far)

- [ ] **Step 3: Commit**

```bash
git add src/services/storage.ts
git commit -m "feat: add unified storage service"
```

---

### Task 2: Migrate `panelState.ts` to Use Storage

**Files:**
- Modify: `src/services/panelState.ts`
- Modify: `src/store/synced.ts`

- [ ] **Step 1: Replace `panelState.ts` contents with storage wrappers**

Replace the entire contents of `src/services/panelState.ts` with:

```typescript
import { readJson, writeJsonSync, removeSync } from './storage'

const PREFIX = 'panel-'

export async function loadPanelState<T = unknown>(panelId: string): Promise<T | null> {
  return readJson<T>(`${PREFIX}${panelId}`)
}

export function savePanelState(panelId: string, state: unknown): void {
  writeJsonSync(`${PREFIX}${panelId}`, state)
}

export function clearPanelState(panelId: string): void {
  removeSync(`${PREFIX}${panelId}`)
}
```

- [ ] **Step 2: Verify build**

Run: `cd /home/grzracz/dev/cotect && npx tsc --noEmit`
Expected: PASS — signatures unchanged, callers unaffected

- [ ] **Step 3: Commit**

```bash
git add src/services/panelState.ts
git commit -m "refactor: migrate panelState to unified storage"
```

---

### Task 3: Migrate `windowManager.ts` to Use Storage

**Files:**
- Modify: `src/services/windowManager.ts`

- [ ] **Step 1: Replace `windowManager.ts` with storage-based implementation**

Replace the entire contents of `src/services/windowManager.ts` with:

```typescript
import { window as neuWindow } from '@neutralinojs/lib'
import { isNeutralino } from './platform'
import { readJson, writeJsonSync, removeSync, listKeys } from './storage'
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
  const keys = await listKeys('wm-layout-')
  return keys
    .map((k) => k.slice('wm-layout-'.length))
    .filter((id) => id !== 'main')
}

// --- Layout persistence ---

export function saveLayout(windowId: string, layout: PersistedLayout): void {
  writeJsonSync(`wm-layout-${windowId}`, layout)
}

export async function loadLayout(windowId: string): Promise<PersistedLayout | null> {
  return readJson<PersistedLayout>(`wm-layout-${windowId}`)
}

export function removeLayout(windowId: string): void {
  removeSync(`wm-layout-${windowId}`)
  removeSync(`wm-zones-${windowId}`)
  removeSync(`wm-geometry-${windowId}`)
}

// --- Zone sizes ---

export function saveZoneSizes(windowId: string, sizes: PersistedZoneSizes): void {
  writeJsonSync(`wm-zones-${windowId}`, sizes)
}

export async function loadZoneSizes(windowId: string): Promise<PersistedZoneSizes | null> {
  return readJson<PersistedZoneSizes>(`wm-zones-${windowId}`)
}

// --- Geometry ---

export function saveGeometry(windowId: string, geometry: PersistedGeometry): void {
  writeJsonSync(`wm-geometry-${windowId}`, geometry)
}

export async function loadGeometry(windowId: string): Promise<PersistedGeometry | null> {
  return readJson<PersistedGeometry>(`wm-geometry-${windowId}`)
}

// --- Session ---

export function saveSession(session: PersistedSession): void {
  writeJsonSync('wm-session-main', session)
}

export async function loadSession(): Promise<PersistedSession | null> {
  return readJson<PersistedSession>('wm-session-main')
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
  if (!isNeutralino()) return

  let lastJson = ''
  geometryPersister = createPollingPersister(2000, async () => {
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

- [ ] **Step 2: Verify build**

Run: `cd /home/grzracz/dev/cotect && npx tsc --noEmit`
Expected: PASS — all exported signatures preserved

Note: The storage key prefixes changed from `cotect-wm-` (FILE_PREFIX + key) to `cotect-wm-` (storage FILE_PREFIX `cotect-` + key `wm-...`). This is the same effective path: `/tmp/cotect-wm-layout-main.json`. Verify by checking the old code: `FILE_PREFIX = '/tmp/cotect-wm-'` concatenated with `layout-${windowId}` = `/tmp/cotect-wm-layout-main.json`. New code: storage `FILE_PREFIX = '/tmp/cotect-'` + key `wm-layout-main` = `/tmp/cotect-wm-layout-main.json`. Paths match.

- [ ] **Step 3: Commit**

```bash
git add src/services/windowManager.ts
git commit -m "refactor: migrate windowManager to unified storage, extract createPollingPersister"
```

---

### Task 4: Fix IPC Race Condition in `channel.ts`

**Files:**
- Modify: `src/services/channel.ts`

- [ ] **Step 1: Rewrite `channel.ts` with per-sender IPC model**

Replace the entire contents of `src/services/channel.ts` with:

```typescript
import { filesystem } from '@neutralinojs/lib'
import { isNeutralino } from '@/services/platform'
import { readJson, writeJsonSync } from '@/services/storage'
import type { PanelPosition } from '@/store/layout'

export type ChannelMessage =
  | { type: 'drag-start'; panelId: string; panelIds: string[]; sourceWindow: string }
  | { type: 'drag-end'; sourceWindow: string }
  | { type: 'drag-move'; screenX: number; screenY: number; sourceWindow: string }
  | { type: 'drag-drop'; panelId: string; panelIds: string[]; targetWindow: string; focusedAt: number; position: PanelPosition; groupKey: string | null }
  | { type: 'window-opened'; windowId: string }
  | { type: 'window-closed'; windowId: string }

let senderId = ''
const handlers: ((msg: ChannelMessage) => void)[] = []

export function initChannel(windowId: string): void {
  senderId = windowId
  if (isNeutralino()) {
    startNeuPolling()
  }
}

// =============================================================================
// Neutralino: per-sender filesystem IPC (no write contention)
// =============================================================================

const IPC_PREFIX = 'ipc-'
const IPC_POS_FILE = '/tmp/cotect-drag-pos.json'
const MESSAGE_TTL = 5000
const POLL_INTERVAL = 100
const POS_POLL_INTERVAL = 30

interface IpcEnvelope {
  sender: string
  data: ChannelMessage
  ts: number
}

interface DragPos {
  sender: string
  screenX: number
  screenY: number
  ts: number
}

let lastSeenTs = Date.now()
let neuPollTimer: ReturnType<typeof setInterval> | null = null
let posPollTimer: ReturnType<typeof setInterval> | null = null
let lastPosTs = Date.now()

async function readSenderEnvelopes(senderKey: string): Promise<IpcEnvelope[]> {
  const data = await readJson<IpcEnvelope[]>(senderKey)
  return data ?? []
}

async function neuPoll(): Promise<void> {
  try {
    // Read all IPC files from all senders
    const entries = await filesystem.readDirectory('/tmp')
    const prefix = 'cotect-ipc-'
    const now = Date.now()

    for (const entry of entries) {
      if (entry.type !== 'FILE' || !entry.entry.startsWith(prefix) || !entry.entry.endsWith('.json')) continue
      const senderKey = entry.entry.slice('cotect-'.length, -5) // e.g. "ipc-main"
      const senderName = senderKey.slice(IPC_PREFIX.length)
      if (senderName === senderId) continue // skip own messages

      const envelopes = await readSenderEnvelopes(senderKey)
      for (const env of envelopes) {
        if (env.ts > lastSeenTs && now - env.ts < MESSAGE_TTL) {
          if (env.data.type === 'drag-start') startPosPolling()
          else if (env.data.type === 'drag-end') stopPosPolling()
          for (const handler of handlers) handler(env.data)
        }
      }
    }

    lastSeenTs = now
  } catch {
    // polling failure — will retry next interval
  }
}

async function posPoll(): Promise<void> {
  try {
    const raw = await filesystem.readFile(IPC_POS_FILE)
    const pos: DragPos = JSON.parse(raw)
    if (pos.sender !== senderId && pos.ts > lastPosTs) {
      lastPosTs = pos.ts
      for (const handler of handlers) {
        handler({ type: 'drag-move', screenX: pos.screenX, screenY: pos.screenY, sourceWindow: pos.sender })
      }
    }
  } catch {
    // file missing — no position yet
  }
}

async function neuBroadcast(message: ChannelMessage): Promise<void> {
  if (message.type === 'drag-move') {
    try {
      const pos: DragPos = { sender: senderId, screenX: message.screenX, screenY: message.screenY, ts: Date.now() }
      await filesystem.writeFile(IPC_POS_FILE, JSON.stringify(pos))
    } catch {
      console.warn('[ipc] Failed to write drag position')
    }
    return
  }

  // Each sender writes only its own file — no read-modify-write contention
  const key = `${IPC_PREFIX}${senderId}`
  const now = Date.now()
  const existing = await readSenderEnvelopes(key)
  const fresh = existing.filter((e) => now - e.ts < MESSAGE_TTL)
  fresh.push({ sender: senderId, data: message, ts: now })
  writeJsonSync(key, fresh)
}

function startNeuPolling(): void {
  if (neuPollTimer) return
  neuPollTimer = setInterval(neuPoll, POLL_INTERVAL)
}

function stopNeuPolling(): void {
  if (neuPollTimer) {
    clearInterval(neuPollTimer)
    neuPollTimer = null
  }
  stopPosPolling()
}

function startPosPolling(): void {
  if (posPollTimer) return
  posPollTimer = setInterval(posPoll, POS_POLL_INTERVAL)
}

function stopPosPolling(): void {
  if (posPollTimer) {
    clearInterval(posPollTimer)
    posPollTimer = null
  }
}

// =============================================================================
// Browser: BroadcastChannel
// =============================================================================

let bcChannel: BroadcastChannel | null = null

function getBcChannel(): BroadcastChannel {
  if (!bcChannel) {
    bcChannel = new BroadcastChannel('cotect')
    bcChannel.addEventListener('message', (event: MessageEvent<ChannelMessage>) => {
      for (const handler of handlers) handler(event.data)
    })
  }
  return bcChannel
}

// =============================================================================
// Public API
// =============================================================================

export async function broadcast(message: ChannelMessage): Promise<void> {
  if (isNeutralino()) {
    await neuBroadcast(message)
  } else {
    getBcChannel().postMessage(message)
  }
}

export function onMessage(handler: (message: ChannelMessage) => void): () => void {
  handlers.push(handler)
  if (!isNeutralino()) getBcChannel()
  return () => {
    const idx = handlers.indexOf(handler)
    if (idx >= 0) handlers.splice(idx, 1)
  }
}

export function closeChannel(): void {
  if (isNeutralino()) {
    stopNeuPolling()
  } else if (bcChannel) {
    bcChannel.close()
    bcChannel = null
  }
  handlers.length = 0
}
```

- [ ] **Step 2: Update callers — `broadcast` is now async**

In `src/App.tsx`, line 111, change:
```typescript
broadcast({ type: 'window-opened', windowId })
```
to:
```typescript
void broadcast({ type: 'window-opened', windowId })
```

Search for all other `broadcast(` calls in the codebase and ensure they either `await` or `void` the result. The main callers are in `usePanelDrag.ts` and `CrossWindowDropOverlay.tsx` — these fire-and-forget calls should use `void broadcast(...)`.

- [ ] **Step 3: Verify build**

Run: `cd /home/grzracz/dev/cotect && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/services/channel.ts src/App.tsx
git commit -m "refactor: fix IPC race condition with per-sender model, make broadcast async"
```

---

### Task 5: Add Parser Mutex to `treesitter.ts`

**Files:**
- Modify: `src/services/treesitter.ts`

- [ ] **Step 1: Add promise-based lock and mutex to `treesitter.ts`**

Replace lines 22-34 (the parser init section) with:

```typescript
let parserPromise: Promise<Parser> | null = null
const languageCache = new Map<string, Language>()
const queryCache = new Map<string, Query>()

// Mutex to serialize setLanguage + parse (parser is single-threaded)
let parseLock: Promise<void> = Promise.resolve()

function withParseLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = parseLock
  let resolve: () => void
  parseLock = new Promise<void>((r) => { resolve = r })
  return prev.then(fn).finally(() => resolve!())
}

async function getParser(): Promise<Parser> {
  if (!parserPromise) {
    parserPromise = (async () => {
      await Parser.init({ locateFile: () => '/tree-sitter.wasm' })
      return new Parser()
    })()
  }
  return parserPromise
}
```

Then wrap the body of `analyzeFile` (lines 65-142) to use the mutex. Replace:

```typescript
export async function analyzeFile(filePath: string, content: string): Promise<FileAnalysis> {
  const config = getConfigForFile(filePath)
  if (!config) return { declarations: [], imports: [] }

  const parser = await getParser()
  const language = await getLanguage(config)
  parser.setLanguage(language)

  const tree = parser.parse(content)
```

with:

```typescript
export async function analyzeFile(filePath: string, content: string): Promise<FileAnalysis> {
  const config = getConfigForFile(filePath)
  if (!config) return { declarations: [], imports: [] }

  return withParseLock(async () => {
    const parser = await getParser()
    const language = await getLanguage(config)
    parser.setLanguage(language)

    const tree = parser.parse(content)
```

And close the `withParseLock` callback at the end of `analyzeFile`, just before the final `}`:

```typescript
    return { declarations, imports }
  })
}
```

- [ ] **Step 2: Verify build**

Run: `cd /home/grzracz/dev/cotect && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/services/treesitter.ts
git commit -m "fix: add mutex to tree-sitter parser to prevent concurrent interference"
```

---

### Task 6: Refactor `synced.ts` to Use Storage

**Files:**
- Modify: `src/store/synced.ts`

- [ ] **Step 1: Replace `synced.ts` contents**

```typescript
import { create, type StateCreator, type StoreApi } from 'zustand'
import { readJson, writeJsonSync, removeSync } from '@/services/storage'

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
  debounceMs?: number
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

export function initAllSyncedStores(): void {
  for (const entry of pending) {
    const debounceMs = 300
    let timer: ReturnType<typeof setTimeout> | null = null
    entry.store.subscribe(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        writeJsonSync(`${STORAGE_PREFIX}${entry.name}`, pickKeys(entry.store.getState(), entry.serializableKeys))
      }, debounceMs)
    })
  }
}

export function clearAllSyncedStores(): void {
  for (const { name } of pending) {
    removeSync(`${STORAGE_PREFIX}${name}`)
  }
}

export async function reloadSyncedStore(name: string): Promise<void> {
  const entry = pending.find((p) => p.name === name)
  if (!entry) return
  const saved = await readJson(`${STORAGE_PREFIX}${name}`)
  if (saved && typeof saved === 'object') {
    entry.store.setState(entry.sanitize ? entry.sanitize(saved as Partial<unknown>) : saved)
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd /home/grzracz/dev/cotect && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/store/synced.ts
git commit -m "refactor: migrate synced store to unified storage, simplify serializable check"
```

---

### Task 7: Extract Panel Operation Helpers in `layout.ts`

**Files:**
- Modify: `src/store/layout.ts`

- [ ] **Step 1: Extract helper functions and simplify reducers**

Replace the entire contents of `src/store/layout.ts` with:

```typescript
import { create } from 'zustand'
import { saveLayout, type PersistedLayout } from '@/services/windowManager'

export type PanelPosition = 'left' | 'right' | 'bottom'

export interface PanelDefinition {
  id: string
  label: string
  defaultPosition: PanelPosition
}

export const PANEL_DEFINITIONS: PanelDefinition[] = [
  { id: 'explorer', label: 'Explorer', defaultPosition: 'left' },
  { id: 'chat', label: 'Chat', defaultPosition: 'right' },
  { id: 'properties', label: 'Properties', defaultPosition: 'right' },
  { id: 'console', label: 'Console', defaultPosition: 'bottom' },
  { id: 'timeline', label: 'Timeline', defaultPosition: 'bottom' },
]

const POSITIONS: PanelPosition[] = ['left', 'right', 'bottom']

export function getPanelLabel(id: string): string {
  return PANEL_DEFINITIONS.find((d) => d.id === id)?.label ?? id
}

// --- Pure helper types ---

interface PanelLocation {
  position: PanelPosition
  groupIndex: number
  tabIndex: number
}

interface LayoutSlice {
  panels: Record<PanelPosition, string[][]>
  sizes: Record<PanelPosition, number[]>
  activeTab: Record<string, number>
}

// --- Pure helper functions ---

function groupKey(group: string[]): string {
  return group[0] ?? ''
}

function renormalize(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0)
  return total > 0 ? sizes.map((s) => s / total) : sizes
}

function cloneSlice(state: LayoutSlice): LayoutSlice {
  const cloneZone = (zone: string[][]) => zone.map((g) => [...g])
  return {
    panels: { left: cloneZone(state.panels.left), right: cloneZone(state.panels.right), bottom: cloneZone(state.panels.bottom) },
    sizes: { left: [...state.sizes.left], right: [...state.sizes.right], bottom: [...state.sizes.bottom] },
    activeTab: { ...state.activeTab },
  }
}

function findPanelLocation(panels: Record<PanelPosition, string[][]>, panelId: string): PanelLocation | null {
  for (const pos of POSITIONS) {
    for (let gi = 0; gi < panels[pos].length; gi++) {
      const ti = panels[pos][gi].indexOf(panelId)
      if (ti >= 0) return { position: pos, groupIndex: gi, tabIndex: ti }
    }
  }
  return null
}

function findGroupLocation(panels: Record<PanelPosition, string[][]>, panelId: string): { position: PanelPosition; groupIndex: number } | null {
  for (const pos of POSITIONS) {
    for (let gi = 0; gi < panels[pos].length; gi++) {
      if (panels[pos][gi].includes(panelId)) return { position: pos, groupIndex: gi }
    }
  }
  return null
}

/** Remove a panel from its group. Cleans up empty groups and migrates activeTab keys. */
function removePanelFromState(slice: LayoutSlice, loc: PanelLocation): void {
  const group = slice.panels[loc.position][loc.groupIndex]
  const oldKey = groupKey(group)
  group.splice(loc.tabIndex, 1)

  if (group.length === 0) {
    slice.panels[loc.position].splice(loc.groupIndex, 1)
    slice.sizes[loc.position].splice(loc.groupIndex, 1)
    slice.sizes[loc.position] = renormalize(slice.sizes[loc.position])
    delete slice.activeTab[oldKey]
  } else {
    const newKey = groupKey(group)
    if (newKey !== oldKey) {
      slice.activeTab[newKey] = slice.activeTab[oldKey] ?? 0
      delete slice.activeTab[oldKey]
    }
    if ((slice.activeTab[newKey] ?? 0) >= group.length) {
      slice.activeTab[newKey] = group.length - 1
    }
  }
}

/** Insert a group into a zone, splitting the neighbor's size. */
function insertGroupIntoZone(slice: LayoutSlice, group: string[], position: PanelPosition, insertIndex: number, neighborIndex?: number): void {
  if (slice.panels[position].length === 0) {
    slice.panels[position].push(group)
    slice.sizes[position] = [1]
  } else {
    const nIdx = neighborIndex ?? (insertIndex < slice.panels[position].length ? insertIndex : slice.panels[position].length - 1)
    const half = slice.sizes[position][nIdx] / 2
    slice.sizes[position][nIdx] = half
    slice.panels[position].splice(insertIndex, 0, group)
    slice.sizes[position].splice(insertIndex, 0, half)
  }
}

// --- Store ---

export interface CrossWindowDrag {
  panelId: string
  panelIds: string[]
  position: PanelPosition
  insertIndex: number
  neighborIndex: number
}

interface LayoutState extends LayoutSlice {
  crossWindowDrag: CrossWindowDrag | null
  movePanel: (panelId: string, to: PanelPosition, insertIndex: number, neighborIndex?: number) => void
  movePanelToTab: (panelId: string, targetPanelId: string) => void
  moveGroup: (panelIds: string[], to: PanelPosition, insertIndex: number, neighborIndex?: number) => void
  moveGroupToTab: (panelIds: string[], targetPanelId: string) => void
  resizePanels: (position: PanelPosition, index: number, ratio: number) => void
  addPanel: (panelId: string, position: PanelPosition) => void
  removePanel: (panelId: string) => void
  setActiveTab: (groupKey: string, index: number) => void
  setCrossWindowDrag: (drag: CrossWindowDrag | null) => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  panels: { left: [], right: [], bottom: [] },
  sizes: { left: [], right: [], bottom: [] },
  activeTab: {},
  crossWindowDrag: null,

  setCrossWindowDrag: (drag) => set({ crossWindowDrag: drag }),

  movePanel: (panelId, to, insertIndex, neighborIndex) =>
    set((state) => {
      const loc = findPanelLocation(state.panels, panelId)
      if (!loc) return state
      const slice = cloneSlice(state)
      removePanelFromState(slice, loc)
      insertGroupIntoZone(slice, [panelId], to, insertIndex, neighborIndex)
      return slice
    }),

  movePanelToTab: (panelId, targetPanelId) =>
    set((state) => {
      if (panelId === targetPanelId) return state
      const srcLoc = findPanelLocation(state.panels, panelId)
      const tgtLoc = findGroupLocation(state.panels, targetPanelId)
      if (!srcLoc || !tgtLoc) return state
      if (srcLoc.position === tgtLoc.position && srcLoc.groupIndex === tgtLoc.groupIndex) return state

      const slice = cloneSlice(state)
      removePanelFromState(slice, srcLoc)

      const newTgt = findGroupLocation(slice.panels, targetPanelId)
      if (!newTgt) return state
      const targetGroup = slice.panels[newTgt.position][newTgt.groupIndex]
      const tgtKey = groupKey(targetGroup)
      targetGroup.push(panelId)
      slice.activeTab[tgtKey] = targetGroup.length - 1
      return slice
    }),

  moveGroup: (panelIds, to, insertIndex, neighborIndex) =>
    set((state) => {
      const slice = cloneSlice(state)
      let group: string[]
      const loc = findGroupLocation(state.panels, panelIds[0])

      if (loc) {
        if (loc.position === to && insertIndex === loc.groupIndex) return state
        group = slice.panels[loc.position].splice(loc.groupIndex, 1)[0]
        const oldKey = groupKey(group)
        slice.sizes[loc.position].splice(loc.groupIndex, 1)
        slice.sizes[loc.position] = renormalize(slice.sizes[loc.position])
        const newKey = groupKey(group)
        if (newKey !== oldKey && slice.activeTab[oldKey] !== undefined) {
          slice.activeTab[newKey] = slice.activeTab[oldKey]
          delete slice.activeTab[oldKey]
        }
      } else {
        group = [...panelIds]
      }

      insertGroupIntoZone(slice, group, to, insertIndex, neighborIndex)
      return slice
    }),

  moveGroupToTab: (panelIds, targetPanelId) =>
    set((state) => {
      const srcLoc = findGroupLocation(state.panels, panelIds[0])
      const tgtLoc = findGroupLocation(state.panels, targetPanelId)
      if (!srcLoc || !tgtLoc) return state
      if (srcLoc.position === tgtLoc.position && srcLoc.groupIndex === tgtLoc.groupIndex) return state

      const slice = cloneSlice(state)
      const srcGroup = slice.panels[srcLoc.position].splice(srcLoc.groupIndex, 1)[0]
      const srcKey = groupKey(srcGroup)
      slice.sizes[srcLoc.position].splice(srcLoc.groupIndex, 1)
      slice.sizes[srcLoc.position] = renormalize(slice.sizes[srcLoc.position])
      delete slice.activeTab[srcKey]

      const newTgt = findGroupLocation(slice.panels, targetPanelId)
      if (!newTgt) return state
      const targetGroup = slice.panels[newTgt.position][newTgt.groupIndex]
      const tgtKey = groupKey(targetGroup)
      targetGroup.push(...srcGroup)
      slice.activeTab[tgtKey] = targetGroup.length - 1
      return slice
    }),

  resizePanels: (position, index, ratio) =>
    set((state) => {
      const sizes = { ...state.sizes, [position]: [...state.sizes[position]] }
      const total = sizes[position][index] + sizes[position][index + 1]
      sizes[position][index] = total * ratio
      sizes[position][index + 1] = total * (1 - ratio)
      return { sizes }
    }),

  addPanel: (panelId, position) =>
    set((state) => {
      if (findPanelLocation(state.panels, panelId)) return state
      const slice = cloneSlice(state)
      insertGroupIntoZone(slice, [panelId], position, slice.panels[position].length)
      return slice
    }),

  removePanel: (panelId) =>
    set((state) => {
      const loc = findPanelLocation(state.panels, panelId)
      if (!loc) return state
      const slice = cloneSlice(state)
      removePanelFromState(slice, loc)
      return slice
    }),

  setActiveTab: (key, index) =>
    set((state) => ({
      activeTab: { ...state.activeTab, [key]: index },
    })),
}))

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

- [ ] **Step 2: Verify build**

Run: `cd /home/grzracz/dev/cotect && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/store/layout.ts
git commit -m "refactor: extract DRY panel helpers (removePanelFromState, insertGroupIntoZone), remove terminal from definitions"
```

---

### Task 8: Decompose `sendMessage` in `chat.ts`

**Files:**
- Modify: `src/store/chat.ts`

- [ ] **Step 1: Replace `chat.ts` with decomposed version**

Replace the entire contents of `src/store/chat.ts` with:

```typescript
import { createSyncedStore } from './synced'

export type ModelId = 'qwen3.5-think' | 'qwen3.5-no-think'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  thinkingTokens?: number
  thinkingDurationMs?: number
  isThinking?: boolean
  isStreaming?: boolean
  totalTokens?: number
  durationMs?: number
  model?: ModelId
}

interface ChatState {
  messages: Message[]
  isGenerating: boolean
  thinkingEnabled: boolean
  abortController: AbortController | null
  addMessage: (msg: Message) => void
  updateMessage: (id: string, update: Partial<Message>) => void
  setGenerating: (v: boolean) => void
  setThinkingEnabled: (v: boolean) => void
  setAbortController: (c: AbortController | null) => void
  clearMessages: () => void
}

export const useChatStore = createSyncedStore<ChatState>('chat', (set) => ({
  messages: [],
  isGenerating: false,
  thinkingEnabled: true,
  abortController: null,
  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),
  updateMessage: (id, update) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, ...update } : m,
      ),
    })),
  setGenerating: (isGenerating) => set({ isGenerating }),
  setThinkingEnabled: (thinkingEnabled) => set({ thinkingEnabled }),
  setAbortController: (abortController) => set({ abortController }),
  clearMessages: () => set({ messages: [] }),
}), {
  sanitize: (saved) => ({
    ...saved,
    isGenerating: false,
    abortController: null,
    messages: (saved as Partial<ChatState>).messages?.map((m) => ({
      ...m,
      isStreaming: false,
      isThinking: false,
    })),
  }),
})

// --- Helpers ---

const API_BASE = '/llm/v1'

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

interface StreamAccumulator {
  content: string
  thinking: string
  rawStream: string
  inThinkTag: boolean
  thinkingTokens: number
  thinkingStartTime: number | null
  totalTokens: number
  streamStartTime: number | null
}

function createAccumulator(): StreamAccumulator {
  return { content: '', thinking: '', rawStream: '', inThinkTag: false, thinkingTokens: 0, thinkingStartTime: null, totalTokens: 0, streamStartTime: null }
}

function buildRequestPayload(messages: Message[], model: ModelId, thinkingEnabled: boolean) {
  const chatMessages = messages
    .filter((m) => !m.isStreaming)
    .map((m) => ({ role: m.role, content: m.content }))

  return {
    model,
    messages: [
      { role: 'system', content: `You are a helpful assistant.${thinkingEnabled ? ' /think' : ' /no_think'}` },
      ...chatMessages,
    ],
    stream: true,
    temperature: 0.5,
    top_p: thinkingEnabled ? 0.95 : 0.8,
    top_k: 20,
    min_p: 0,
    repetition_penalty: 1.2,
    repeat_last_n: 1024,
    chat_template_kwargs: { enable_thinking: thinkingEnabled },
  }
}

function processStreamChunk(acc: StreamAccumulator, text: string, reasoning: string): void {
  if (reasoning || text) {
    if (!acc.streamStartTime) acc.streamStartTime = Date.now()
    acc.totalTokens++
  }

  if (reasoning) {
    if (!acc.thinkingStartTime) acc.thinkingStartTime = Date.now()
    acc.thinking += reasoning
    acc.thinkingTokens++
  }

  if (text) acc.rawStream += text

  if (!acc.rawStream) return

  let remaining = acc.rawStream
  if (acc.inThinkTag) {
    const closeIdx = remaining.indexOf('</think>')
    if (closeIdx !== -1) {
      acc.thinking += remaining.slice(0, closeIdx)
      acc.thinkingTokens += countWords(remaining.slice(0, closeIdx))
      acc.inThinkTag = false
      remaining = remaining.slice(closeIdx + 8)
    } else {
      acc.thinking += remaining
      acc.thinkingTokens += countWords(remaining)
      acc.rawStream = ''
      return
    }
  }

  const openIdx = remaining.indexOf('<think>')
  if (openIdx !== -1) {
    acc.content += remaining.slice(0, openIdx)
    if (!acc.thinkingStartTime) acc.thinkingStartTime = Date.now()
    acc.inThinkTag = true
    const afterOpen = remaining.slice(openIdx + 7)
    const closeIdx = afterOpen.indexOf('</think>')
    if (closeIdx !== -1) {
      acc.thinking += afterOpen.slice(0, closeIdx)
      acc.thinkingTokens += countWords(afterOpen.slice(0, closeIdx))
      acc.inThinkTag = false
      acc.content += afterOpen.slice(closeIdx + 8)
    } else {
      acc.thinking += afterOpen
      acc.thinkingTokens += countWords(afterOpen)
    }
  } else {
    acc.content += remaining
  }
  acc.rawStream = ''
}

// --- Main send function ---

export async function sendMessage(content: string) {
  const { addMessage, setAbortController, setGenerating, updateMessage } = useChatStore.getState()
  if (useChatStore.getState().isGenerating) return

  const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content }
  addMessage(userMsg)

  const assistantId = crypto.randomUUID()
  addMessage({ id: assistantId, role: 'assistant', content: '', thinking: '', isStreaming: true })

  const abort = new AbortController()
  setAbortController(abort)
  setGenerating(true)

  const acc = createAccumulator()
  const { thinkingEnabled, messages } = useChatStore.getState()
  const model: ModelId = thinkingEnabled ? 'qwen3.5-think' : 'qwen3.5-no-think'

  // RAF-based batching
  let rafId: number | null = null
  let dirty = false

  function scheduleFlush() {
    if (!dirty || rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      if (!dirty) return
      dirty = false
      updateMessage(assistantId, {
        content: acc.content,
        thinking: acc.thinking,
        thinkingTokens: acc.thinkingTokens,
        thinkingDurationMs: acc.thinkingStartTime ? Date.now() - acc.thinkingStartTime : 0,
        isThinking: acc.inThinkTag,
        totalTokens: acc.totalTokens,
        durationMs: acc.streamStartTime ? Date.now() - acc.streamStartTime : 0,
        model,
      })
    })
  }

  try {
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abort.signal,
      body: JSON.stringify(buildRequestPayload(messages, model, thinkingEnabled)),
    })

    if (!res.ok) throw new Error(`API error: ${res.status}`)
    const reader = res.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') break

        try {
          const delta = JSON.parse(data).choices?.[0]?.delta
          if (!delta) continue
          processStreamChunk(acc, delta.content || '', delta.reasoning_content || '')
          dirty = true
          scheduleFlush()
        } catch {
          // skip malformed chunks
        }
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      updateMessage(assistantId, {
        content: acc.content || `Error: ${(err as Error).message}`,
      })
    }
  } finally {
    if (rafId !== null) cancelAnimationFrame(rafId)
    updateMessage(assistantId, {
      content: acc.content,
      thinking: acc.thinking.trimEnd(),
      thinkingTokens: acc.thinkingTokens,
      thinkingDurationMs: acc.thinkingStartTime ? Date.now() - acc.thinkingStartTime : 0,
      isThinking: false,
      isStreaming: false,
      totalTokens: acc.totalTokens,
      durationMs: acc.streamStartTime ? Date.now() - acc.streamStartTime : 0,
      model,
    })
    setGenerating(false)
    setAbortController(null)
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd /home/grzracz/dev/cotect && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/store/chat.ts
git commit -m "refactor: decompose sendMessage into buildRequestPayload, processStreamChunk, countWords"
```

---

### Task 9: Extract Import Resolution in `browser.ts`

**Files:**
- Modify: `src/store/browser.ts`

- [ ] **Step 1: Extract `resolveImportCandidates` and split `generateNodes`**

Replace the entire contents of `src/store/browser.ts` with:

```typescript
import { create } from 'zustand'
import type { Edge } from '@xyflow/react'
import { readDirectory, readFileContent, type FSEntry } from '@/services/filesystem'
import { analyzeFile, type FileAnalysis } from '@/services/treesitter'
import { layoutTree } from '@/components/Canvas/layout'
import type { AppNode } from '@/types/nodes'

export type ViewMode = 'directory' | 'file'

interface BreadcrumbEntry {
  path: string
  label: string
  mode: ViewMode
}

interface BrowserState {
  rootPath: string
  currentPath: string
  viewMode: ViewMode
  breadcrumbs: BreadcrumbEntry[]
  loading: boolean
  entries: FSEntry[]
  fileAnalysis: FileAnalysis | null
  siblingAnalyses: Map<string, FileAnalysis>

  openRoot: (path: string) => Promise<void>
  navigateTo: (path: string, mode: ViewMode) => Promise<void>
  navigateToBreadcrumb: (index: number) => void
  generateNodes: () => { nodes: AppNode[]; edges: Edge[] }
}

// --- Helpers ---

const IMPORT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']

function resolveImportCandidates(basePath: string): string[] {
  return [basePath, ...IMPORT_EXTENSIONS.map((ext) => `${basePath}${ext}`)]
}

function findMatchingFile(resolvedPath: string, fileSet: Set<string>): string | undefined {
  return resolveImportCandidates(resolvedPath).find((c) => fileSet.has(c))
}

function generateDirectoryNodes(entries: FSEntry[]): { nodes: AppNode[]; edges: Edge[] } {
  const nodes: AppNode[] = entries.map((entry): AppNode =>
    entry.isDirectory
      ? { id: entry.path, type: 'folder', position: { x: 0, y: 0 }, data: { label: entry.name, path: entry.path, isDirectory: true as const } }
      : { id: entry.path, type: 'file', position: { x: 0, y: 0 }, data: { label: entry.name, path: entry.path } }
  )
  return layoutTree(nodes, [])
}

function generateFileNodes(
  fileAnalysis: FileAnalysis,
  currentPath: string,
  siblingAnalyses: Map<string, FileAnalysis>,
): { nodes: AppNode[]; edges: Edge[] } {
  const nodes: AppNode[] = []
  const edges: Edge[] = []
  const fileId = `file:${currentPath}`

  for (const decl of fileAnalysis.declarations) {
    const nodeId = `${fileId}:${decl.name}`
    if (decl.kind === 'class') {
      nodes.push({
        id: nodeId, type: 'classNode', position: { x: 0, y: 0 },
        data: { label: decl.name, kind: 'class' as const, startLine: decl.startLine, endLine: decl.endLine },
      })
    } else {
      nodes.push({
        id: nodeId, type: 'functionNode', position: { x: 0, y: 0 },
        data: { label: decl.name, kind: 'function' as const, startLine: decl.startLine, endLine: decl.endLine },
      })
    }

    for (const method of decl.children) {
      const methodId = `${nodeId}:${method.name}`
      nodes.push({
        id: methodId, type: 'functionNode', position: { x: 0, y: 0 },
        data: { label: method.name, kind: 'function', startLine: method.startLine, endLine: method.endLine, isMethod: true },
      })
      edges.push({ id: `e-${nodeId}-${methodId}`, source: nodeId, target: methodId, type: 'smoothstep' })
    }
  }

  const addedNodeIds = new Set(nodes.map((n) => n.id))

  for (const imp of fileAnalysis.imports) {
    if (!imp.resolvedPath) continue
    const candidates = new Set(resolveImportCandidates(imp.resolvedPath))
    for (const [resolvedFile, sibAnalysis] of siblingAnalyses) {
      if (!candidates.has(resolvedFile)) continue
      const sibFileId = `sibling:${resolvedFile}`
      const fileName = resolvedFile.split('/').pop() || resolvedFile
      if (!addedNodeIds.has(sibFileId)) {
        addedNodeIds.add(sibFileId)
        nodes.push({
          id: sibFileId, type: 'file', position: { x: 0, y: 0 },
          data: { label: fileName, path: resolvedFile, isImport: true, declarationCount: sibAnalysis.declarations.length },
        })
      }
      edges.push({
        id: `e-import-${fileId}-${sibFileId}`, source: nodes[0]?.id || fileId, target: sibFileId,
        type: 'smoothstep', animated: true, label: 'imports', style: { stroke: '#6366f1' },
      })
      break
    }
  }

  return layoutTree(nodes, edges)
}

// --- Store ---

export const useBrowserStore = create<BrowserState>((set, get) => ({
  rootPath: '',
  currentPath: '',
  viewMode: 'directory',
  breadcrumbs: [],
  loading: false,
  entries: [],
  fileAnalysis: null,
  siblingAnalyses: new Map(),

  openRoot: async (path) => {
    set({ rootPath: path, breadcrumbs: [] })
    await get().navigateTo(path, 'directory')
  },

  navigateTo: async (path, mode) => {
    set({ loading: true })

    if (mode === 'directory') {
      const entries = await readDirectory(path)
      const state = get()
      const breadcrumbs: BreadcrumbEntry[] = [
        ...state.breadcrumbs.filter((b) => path.startsWith(b.path) && b.path !== path),
        { path, label: path.split('/').pop() || path, mode },
      ]
      set({ currentPath: path, viewMode: mode, entries, fileAnalysis: null, breadcrumbs, loading: false, siblingAnalyses: new Map() })
    } else {
      const [content, dirEntries] = await Promise.all([
        readFileContent(path),
        readDirectory(path.substring(0, path.lastIndexOf('/'))),
      ])
      const analysis = await analyzeFile(path, content)
      const dirFileSet = new Set(dirEntries.filter((e) => !e.isDirectory).map((e) => e.path))

      // Resolve imports to sibling files
      const importJobs: { resolvedFile: string }[] = []
      for (const imp of analysis.imports) {
        if (!imp.resolvedPath) continue
        const match = findMatchingFile(imp.resolvedPath, dirFileSet)
        if (match) importJobs.push({ resolvedFile: match })
      }

      // Analyze siblings in parallel
      const siblingAnalyses = new Map<string, FileAnalysis>()
      const results = await Promise.allSettled(
        importJobs.map(async ({ resolvedFile }) => {
          const sibContent = await readFileContent(resolvedFile)
          const sibAnalysis = await analyzeFile(resolvedFile, sibContent)
          return { resolvedFile, sibAnalysis }
        })
      )
      for (const result of results) {
        if (result.status === 'fulfilled') {
          siblingAnalyses.set(result.value.resolvedFile, result.value.sibAnalysis)
        }
      }

      const state = get()
      const fileName = path.split('/').pop() || path
      const breadcrumbs: BreadcrumbEntry[] = [
        ...state.breadcrumbs.filter((b) => b.mode === 'directory'),
        { path, label: fileName, mode },
      ]
      set({ currentPath: path, viewMode: mode, fileAnalysis: analysis, entries: [], breadcrumbs, loading: false, siblingAnalyses })
    }
  },

  navigateToBreadcrumb: (index) => {
    const { breadcrumbs } = get()
    const target = breadcrumbs[index]
    if (!target) return
    get().navigateTo(target.path, target.mode)
  },

  generateNodes: () => {
    const { viewMode, entries, fileAnalysis, currentPath, siblingAnalyses } = get()
    if (viewMode === 'directory') return generateDirectoryNodes(entries)
    if (viewMode === 'file' && fileAnalysis) return generateFileNodes(fileAnalysis, currentPath, siblingAnalyses)
    return { nodes: [], edges: [] }
  },
}))
```

- [ ] **Step 2: Verify build**

Run: `cd /home/grzracz/dev/cotect && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/store/browser.ts
git commit -m "refactor: extract resolveImportCandidates, split generateNodes into directory/file helpers"
```

---

### Task 10: Delete Terminal Store, Component, and Dependencies

**Files:**
- Delete: `src/store/terminal.ts`
- Delete: `src/components/Terminal/index.tsx`
- Modify: `src/store/index.ts`
- Modify: `src/components/Layout/PanelArea.tsx` (if it renders Terminal)

- [ ] **Step 1: Remove terminal exports from `src/store/index.ts`**

Remove line 10:
```typescript
export { useTerminalStore, runCommand, killActiveProcess } from './terminal'
```

- [ ] **Step 2: Delete terminal files**

```bash
rm src/store/terminal.ts
rm src/components/Terminal/index.tsx
```

- [ ] **Step 3: Search for and remove all terminal references**

Search for any remaining imports of `useTerminalStore`, `runCommand`, `killActiveProcess`, or `Terminal` component throughout the codebase. Update any panel rendering switch/map that renders the Terminal panel to remove that case.

In `src/components/Layout/PanelArea.tsx` (or wherever panels are rendered), remove the Terminal case from the panel content renderer.

- [ ] **Step 4: Remove xterm dependencies**

```bash
cd /home/grzracz/dev/cotect && yarn remove @xterm/xterm @xterm/addon-fit
```

- [ ] **Step 5: Verify build**

Run: `cd /home/grzracz/dev/cotect && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: remove Terminal panel, store, and xterm dependencies"
```

---

### Task 11: Create BaseNode Component

**Files:**
- Create: `src/components/Canvas/nodes/BaseNode.tsx`
- Modify: `src/components/Canvas/nodes/FileNode.tsx`
- Modify: `src/components/Canvas/nodes/FolderNode.tsx`
- Modify: `src/components/Canvas/nodes/ClassNode.tsx`
- Modify: `src/components/Canvas/nodes/FunctionNode.tsx`

- [ ] **Step 1: Create `src/components/Canvas/nodes/BaseNode.tsx`**

```typescript
import type { ReactNode } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { LucideIcon } from 'lucide-react'

interface BaseNodeProps {
  icon: LucideIcon
  iconClassName?: string
  label: string
  borderClassName?: string
  className?: string
  onClick?: () => void
  badge?: string
  children?: ReactNode
}

export default function BaseNode({ icon: Icon, iconClassName, label, borderClassName = 'border-border', className = '', onClick, badge, children }: BaseNodeProps) {
  return (
    <div
      className={`bg-background/90 backdrop-blur border rounded-lg px-4 py-3 min-w-[160px] ${borderClassName} ${onClick ? 'cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors' : ''} ${className}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${iconClassName ?? 'text-muted-foreground'}`} />
        <span className="text-sm font-medium text-foreground truncate">{label}</span>
        {badge && <span className="text-xs text-muted-foreground">{badge}</span>}
      </div>
      {children}
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <Handle type="target" position={Position.Top} className="opacity-0" />
    </div>
  )
}
```

- [ ] **Step 2: Simplify `FileNode.tsx`**

```typescript
import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { FileText, FileCode } from 'lucide-react'
import { useBrowserStore } from '@/store'
import { getConfigForFile } from '@/services/treesitter-queries'
import type { FileNode } from '@/types/nodes'
import BaseNode from './BaseNode'

export default memo(function FileNode({ data }: NodeProps<FileNode>) {
  const navigateTo = useBrowserStore((s) => s.navigateTo)
  const parseable = getConfigForFile(data.label) !== null

  return (
    <BaseNode
      icon={parseable ? FileCode : FileText}
      iconClassName={parseable ? 'text-blue-400' : 'text-muted-foreground'}
      label={data.label}
      borderClassName={data.isImport ? 'border-indigo-500/50 border-dashed' : 'border-border'}
      className="min-w-[180px]"
      onClick={parseable ? () => navigateTo(data.path, 'file') : undefined}
    >
      {data.isImport && data.declarationCount != null && (
        <div className="text-xs text-muted-foreground mt-1">{data.declarationCount} declarations</div>
      )}
    </BaseNode>
  )
})
```

- [ ] **Step 3: Simplify `FolderNode.tsx`**

```typescript
import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Folder } from 'lucide-react'
import { useBrowserStore } from '@/store'
import type { FolderNode } from '@/types/nodes'
import BaseNode from './BaseNode'

export default memo(function FolderNode({ data }: NodeProps<FolderNode>) {
  const navigateTo = useBrowserStore((s) => s.navigateTo)
  return (
    <BaseNode
      icon={Folder}
      iconClassName="text-yellow-500"
      label={data.label}
      className="min-w-[180px]"
      onClick={() => navigateTo(data.path, 'directory')}
    />
  )
})
```

- [ ] **Step 4: Simplify `ClassNode.tsx`**

```typescript
import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Box } from 'lucide-react'
import type { ClassNode } from '@/types/nodes'
import BaseNode from './BaseNode'

export default memo(function ClassNode({ data }: NodeProps<ClassNode>) {
  return (
    <BaseNode
      icon={Box}
      iconClassName="text-purple-400"
      label={data.label}
      borderClassName="border-purple-500/50"
      className="min-w-[180px]"
      badge="class"
    >
      <div className="text-xs text-muted-foreground mt-0.5">L{data.startLine}–{data.endLine}</div>
    </BaseNode>
  )
})
```

- [ ] **Step 5: Simplify `FunctionNode.tsx`**

```typescript
import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Braces } from 'lucide-react'
import type { FunctionNode } from '@/types/nodes'
import BaseNode from './BaseNode'

export default memo(function FunctionNode({ data }: NodeProps<FunctionNode>) {
  return (
    <BaseNode
      icon={Braces}
      iconClassName="text-emerald-400"
      label={data.label}
      badge="fn"
      className={data.isMethod ? 'ml-4' : ''}
    >
      <div className="text-xs text-muted-foreground mt-0.5">L{data.startLine}–{data.endLine}</div>
    </BaseNode>
  )
})
```

- [ ] **Step 6: Verify build**

Run: `cd /home/grzracz/dev/cotect && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/Canvas/nodes/
git commit -m "refactor: extract BaseNode component, simplify all node variants"
```

---

### Task 12: Extract `useScrollToBottom` Hook

**Files:**
- Create: `src/hooks/useScrollToBottom.ts`
- Modify: `src/components/Chat/index.tsx`
- Modify: `src/components/Console/index.tsx`

- [ ] **Step 1: Create `src/hooks/useScrollToBottom.ts`**

```typescript
import { useEffect, useRef } from 'react'

export function useScrollToBottom(dep: unknown) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
  }, [dep])

  return bottomRef
}
```

- [ ] **Step 2: Update Chat to use hook**

Replace `src/components/Chat/index.tsx` with:

```typescript
import { useChatStore } from '@/store/chat'
import ChatMessage from './ChatMessage'
import ChatInput from './ChatInput'
import { useScrollToBottom } from '@/hooks/useScrollToBottom'

export default function Chat() {
  const messages = useChatStore((s) => s.messages)
  const bottomRef = useScrollToBottom(messages.length)

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1">
        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Start a conversation
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
      <ChatInput />
    </div>
  )
}
```

- [ ] **Step 3: Update Console to use hook**

In `src/components/Console/index.tsx`, replace the scroll logic:

Remove:
```typescript
const bottomRef = useRef<HTMLDivElement>(null)
```
and:
```typescript
useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [filtered.length])
```

Add import:
```typescript
import { useScrollToBottom } from '@/hooks/useScrollToBottom'
```

Add at the top of the component:
```typescript
const bottomRef = useScrollToBottom(filtered.length)
```

Remove `useRef` from the react imports if no longer needed.

- [ ] **Step 4: Verify build**

Run: `cd /home/grzracz/dev/cotect && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useScrollToBottom.ts src/components/Chat/index.tsx src/components/Console/index.tsx
git commit -m "refactor: extract useScrollToBottom hook, share between Chat and Console"
```

---

### Task 13: Fix Node Type Safety

**Files:**
- Modify: `src/types/nodes.ts`

- [ ] **Step 1: Remove `[key: string]: unknown` from all interfaces**

Replace the entire contents of `src/types/nodes.ts` with:

```typescript
import type { Node } from '@xyflow/react'

export interface FolderNodeData {
  label: string
  path: string
  isDirectory: true
}

export interface FileNodeData {
  label: string
  path: string
  isDirectory?: false
  isImport?: boolean
  declarationCount?: number
}

export interface FunctionNodeData {
  label: string
  kind: 'function'
  startLine: number
  endLine: number
  isMethod?: boolean
}

export interface ClassNodeData {
  label: string
  kind: 'class'
  startLine: number
  endLine: number
}

export type FolderNode = Node<FolderNodeData, 'folder'>
export type FileNode = Node<FileNodeData, 'file'>
export type FunctionNode = Node<FunctionNodeData, 'functionNode'>
export type ClassNode = Node<ClassNodeData, 'classNode'>

export type AppNode = FolderNode | FileNode | FunctionNode | ClassNode
```

- [ ] **Step 2: Verify build — fix any type errors that surface**

Run: `cd /home/grzracz/dev/cotect && npx tsc --noEmit`

React Flow's `Node` type may require `Record<string, unknown>` for the data generic. If so, extend each interface:

```typescript
export interface FolderNodeData extends Record<string, unknown> {
```

Only add this if the build fails.

- [ ] **Step 3: Commit**

```bash
git add src/types/nodes.ts
git commit -m "refactor: remove loose [key: string]: unknown from node data interfaces"
```

---

### Task 14: Extract `useWindowLifecycle` Hook and `WindowShell`

**Files:**
- Create: `src/hooks/useWindowLifecycle.ts`
- Create: `src/components/WindowShell.tsx`
- Modify: `src/App.tsx`
- Modify: `src/views/Canvas.tsx`
- Modify: `src/views/NewWindow.tsx`

- [ ] **Step 1: Create `src/hooks/useWindowLifecycle.ts`**

```typescript
import { useEffect, useState } from 'react'
import { window as neuWindow } from '@neutralinojs/lib'
import { getWindowId, onWindowClose, closeWindow, createWindow, killChildWindows, setWindowSizeConstraints, showWindow, isNeutralino } from '@/services/platform'
import { broadcast, closeChannel, initChannel, onMessage } from '@/services/channel'
import { loadLayout, loadGeometry, loadSession, getChildWindowIds, removeLayout, startGeometryPersistence, stopGeometryPersistence, startSessionPersistence, stopSessionPersistence } from '@/services/windowManager'
import { useBrowserStore } from '@/store/browser'
import { loadLayoutIntoStore, startLayoutPersistence, stopLayoutPersistence } from '@/store/layout'
import { initAllSyncedStores, clearAllSyncedStores } from '@/store/synced'

const windowId = getWindowId()
const isMain = windowId === 'main'

const DEFAULT_MAIN_LAYOUT = {
  panels: { left: [['explorer']], right: [['chat']], bottom: [['console']] },
  sizes: { left: [1], right: [1], bottom: [1] },
  activeTab: {},
}

export function useWindowLifecycle() {
  const [isReady, setIsReady] = useState(false)

  // One-time channel + store init
  useEffect(() => {
    setWindowSizeConstraints(isMain ? 1280 : 400, isMain ? 720 : 300)
    initChannel(windowId)
    if (isMain) clearAllSyncedStores()
    initAllSyncedStores()
    return () => { closeChannel() }
  }, [])

  // Async state restoration
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const [saved, geo, childIds, session] = await Promise.all([
        loadLayout(windowId),
        isNeutralino() ? loadGeometry(windowId) : null,
        isMain ? getChildWindowIds() : [],
        isMain ? loadSession() : null,
      ])
      if (cancelled) return

      startGeometryPersistence(windowId)

      if (isNeutralino() && geo) {
        await neuWindow.move(geo.x, geo.y).catch(() => {})
        if (isMain) await neuWindow.setSize({ width: geo.width, height: geo.height }).catch(() => {})
        if (geo.isMaximized) await neuWindow.maximize().catch(() => {})
      }

      loadLayoutIntoStore(saved ?? (isMain ? DEFAULT_MAIN_LAYOUT : { panels: { left: [], right: [], bottom: [] }, sizes: { left: [], right: [], bottom: [] }, activeTab: {} }))
      startLayoutPersistence(windowId)

      if (isMain) showWindow()
      const splash = document.getElementById('splash')
      if (splash) {
        splash.classList.add('hide')
        setTimeout(() => splash.remove(), 200)
      }

      if (isMain) {
        if (childIds.length > 0) {
          const geometries = await Promise.all(childIds.map((id) => loadGeometry(id)))
          if (cancelled) return
          for (let i = 0; i < childIds.length; i++) createWindow(childIds[i], geometries[i])
        }

        if (session?.rootPath) {
          try {
            await useBrowserStore.getState().openRoot(session.rootPath)
            if (cancelled) return
            if (session.currentPath && session.currentPath !== session.rootPath) {
              await useBrowserStore.getState().navigateTo(session.currentPath, session.viewMode)
            }
          } catch {
            // Root path no longer exists — skip
          }
        }
        startSessionPersistence()
      }

      setIsReady(true)
    })()

    void broadcast({ type: 'window-opened', windowId })

    return () => { cancelled = true }
  }, [])

  // Child window: close when main closes
  useEffect(() => {
    if (isMain) return
    return onMessage((msg) => {
      if (msg.type === 'window-closed' && msg.windowId === 'main') closeWindow()
    })
  }, [])

  // Window close handler
  useEffect(() => {
    return onWindowClose(() => {
      stopLayoutPersistence()
      stopGeometryPersistence()
      stopSessionPersistence()
      if (!isMain) removeLayout(windowId)
      if (isMain) killChildWindows()
      closeChannel()
      closeWindow()
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

- [ ] **Step 2: Create `src/components/WindowShell.tsx`**

```typescript
import type { ReactNode } from 'react'

export default function WindowShell({ children }: { children: ReactNode }) {
  return (
    <div className="dark w-screen h-screen bg-background text-foreground relative">
      {children}
    </div>
  )
}
```

- [ ] **Step 3: Simplify `src/App.tsx`**

```typescript
import Canvas from '@/views/Canvas'
import NewWindow from '@/views/NewWindow'
import { useWindowLifecycle } from '@/hooks/useWindowLifecycle'

function App() {
  const { isMain, isReady } = useWindowLifecycle()
  if (!isReady) return null
  return isMain ? <Canvas /> : <NewWindow />
}

export default App
```

- [ ] **Step 4: Update `src/views/Canvas.tsx` to use WindowShell**

```typescript
import { useEffect, useMemo } from 'react'
import { ReactFlow, Background, BackgroundVariant } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCanvasStore, useBrowserStore } from '@/store'
import Layout from '@/components/Layout'
import { nodeTypes } from '@/components/Canvas/nodes'
import Breadcrumbs from '@/components/Canvas/Breadcrumbs'
import WindowShell from '@/components/WindowShell'

const proOptions = { hideAttribution: true }

export default function Canvas() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, setNodes, setEdges } =
    useCanvasStore()

  const currentPath = useBrowserStore((s) => s.currentPath)
  const viewMode = useBrowserStore((s) => s.viewMode)
  const entryCount = useBrowserStore((s) => s.entries.length)
  const declCount = useBrowserStore((s) => s.fileAnalysis?.declarations.length ?? -1)

  const generated = useMemo(
    () => useBrowserStore.getState().generateNodes(),
    [currentPath, viewMode, entryCount, declCount],
  )

  useEffect(() => {
    setNodes(generated.nodes)
    setEdges(generated.edges)
  }, [generated, setNodes, setEdges])

  return (
    <WindowShell>
      <div className="absolute inset-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          colorMode="dark"
          proOptions={proOptions}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#555555" />
        </ReactFlow>
      </div>
      <Breadcrumbs />
      <div className="absolute inset-0 pointer-events-none z-10">
        <Layout />
      </div>
    </WindowShell>
  )
}
```

- [ ] **Step 5: Update `src/views/NewWindow.tsx` to use WindowShell**

```typescript
import Layout from '@/components/Layout'
import WindowShell from '@/components/WindowShell'

export default function NewWindow() {
  return (
    <WindowShell>
      <div className="absolute inset-0 z-10">
        <Layout mode="panel" />
      </div>
    </WindowShell>
  )
}
```

- [ ] **Step 6: Verify build**

Run: `cd /home/grzracz/dev/cotect && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useWindowLifecycle.ts src/components/WindowShell.tsx src/App.tsx src/views/Canvas.tsx src/views/NewWindow.tsx
git commit -m "refactor: extract useWindowLifecycle hook and WindowShell, simplify App to 6 lines"
```

---

### Task 15: Extract Layout Constants

**Files:**
- Create: `src/lib/constants.ts`
- Modify: `src/components/Layout/index.tsx`
- Modify: `src/components/Canvas/layout.ts`

- [ ] **Step 1: Create `src/lib/constants.ts`**

```typescript
// Layout zone constraints
export const MIN_SIDE_ZONE = 120
export const MIN_BOTTOM_ZONE = 80

// Canvas node dimensions
export const NODE_WIDTH = 200
export const NODE_HEIGHT = 60
export const NODE_H_GAP = 40
export const NODE_V_GAP = 80
```

- [ ] **Step 2: Update `src/components/Layout/index.tsx`**

Replace:
```typescript
const MIN_SIDE = 120
const MIN_BOTTOM = 80
```
with:
```typescript
import { MIN_SIDE_ZONE, MIN_BOTTOM_ZONE } from '@/lib/constants'
```

Then replace all `MIN_SIDE` with `MIN_SIDE_ZONE` and `MIN_BOTTOM` with `MIN_BOTTOM_ZONE` throughout the file.

- [ ] **Step 3: Update `src/components/Canvas/layout.ts`**

Replace:
```typescript
const NODE_WIDTH = 200
const NODE_HEIGHT = 60
const H_GAP = 40
const V_GAP = 80
```
with:
```typescript
import { NODE_WIDTH, NODE_HEIGHT, NODE_H_GAP, NODE_V_GAP } from '@/lib/constants'
```

Then replace `H_GAP` with `NODE_H_GAP` and `V_GAP` with `NODE_V_GAP` throughout the file.

- [ ] **Step 4: Verify build**

Run: `cd /home/grzracz/dev/cotect && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/constants.ts src/components/Layout/index.tsx src/components/Canvas/layout.ts
git commit -m "refactor: extract layout constants to shared constants file"
```

---

### Task 16: Delete `panelState.ts` (now redundant)

**Files:**
- Delete: `src/services/panelState.ts`
- Modify: `src/store/synced.ts` (already updated in Task 6 to use storage directly)

- [ ] **Step 1: Verify `panelState.ts` has no remaining importers**

```bash
cd /home/grzracz/dev/cotect && grep -r "panelState" src/ --include="*.ts" --include="*.tsx"
```

If `synced.ts` was already updated in Task 6, it should not import from `panelState`. If any file still imports it, update that file to import from `@/services/storage` instead.

- [ ] **Step 2: Delete the file**

```bash
rm src/services/panelState.ts
```

- [ ] **Step 3: Verify build**

Run: `cd /home/grzracz/dev/cotect && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete panelState.ts, replaced by unified storage"
```

---

### Task 17: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Full build check**

```bash
cd /home/grzracz/dev/cotect && npx tsc --noEmit && yarn build
```

Expected: PASS — no type errors, build succeeds

- [ ] **Step 2: Dev server smoke test**

```bash
cd /home/grzracz/dev/cotect && yarn vite:dev
```

Open in browser. Verify:
- Layout loads (panels visible)
- Chat panel sends messages
- Console captures logs
- Canvas shows nodes when browsing a project
- Panel drag-and-drop works
- No Terminal panel appears in panel definitions

- [ ] **Step 3: Check for orphaned imports**

```bash
cd /home/grzracz/dev/cotect && grep -r "terminal" src/ --include="*.ts" --include="*.tsx" -i
```

Expected: No results (all terminal references removed)

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final cleanup after architectural refactor"
```
