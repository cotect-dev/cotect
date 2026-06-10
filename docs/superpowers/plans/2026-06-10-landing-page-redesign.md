# Landing Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the landing page's single-code-node demos with three sections that mount the real Canvas, Graph, and Health views against seeded in-memory stores, and replace all "early access" CTAs with download buttons.

**Architecture:** A `demoMode` flag in `src/lib/demoMode.ts` guards the few app code paths that touch Tauri or hijack global input. The landing entry awaits `initPlatform()` (browser fallback), enables demo mode, and seeds the real zustand stores from one fictional mini-repo dataset in `landing/demoData.ts`. Each demo section lazy-mounts the real view in a bounded container with a short autoplay script that drives real store actions and cancels on first user input.

**Tech Stack:** React 19, zustand, @xyflow/react (ReactFlow), CodeMirror 6 (@codemirror/merge), Tailwind 4, Vite (vite.landing.config.ts), vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-06-10-landing-page-redesign-design.md`

**Copy rule (applies to every task that writes user-visible text):** no em dashes, no "it's not X, it's Y" constructions, no AI-marketing words (seamlessly, effortlessly, supercharge). Use periods, commas, colons, and the `·` separator. The heading "This is not a screenshot." is explicitly approved and stays.

## Verified codebase facts (do not re-derive)

- `vite.landing.config.ts` roots at `landing/`, resolves `@/` to `src/`, `publicDir: false`.
- `landing/landing.css` imports `src/index.css`; the full app theme and Tailwind tokens are available on the landing page.
- `src/services/platform/index.ts`: `initPlatform()` picks a browser platform when `'__TAURI_INTERNALS__' in window` is false. `getPlatform()` THROWS if `initPlatform()` was never awaited. Stores call `getPlatform()` only inside actions.
- No store module executes Tauri calls at import time. Importing `Canvas`, `Graph`, `Health` in a browser is safe.
- `src/views/Canvas.tsx`: `CanvasFlow` (lines ~77-316) is internal, NOT exported. The `initRoot` effect skips when `columns[0]?.path === rootPath`. CanvasFlow reads `[data-zone="left"]` and falls back to width 0 when absent.
- `src/components/Graph/index.tsx`: a `useEffect` (~lines 265-269) calls `scan(rootPath)` whenever `rootPath !== lastScannedRef.current`; it WILL fire on first demo mount and clobber seeded state unless guarded. `onNodeClick` calls `useCanvasStore.focusFileByPath(node.id)` (filesystem navigation). Selected node = canvas-focused file if it exists in the graph, else highest `score` node.
- `src/components/Health/index.tsx`: auto-calls `analyze(rootPath)` only when `analyzedRoot !== rootPath`; seeding `analyzedRoot === rootPath` prevents it. Health needs a bounded-height parent (`h-full overflow-hidden`, scrolls internally).
- `src/hooks/useCanvasKeyboard.ts`: registers a `document`-level keydown fallback (~line 270) that claims W/S/A/D/arrow keys whenever `viewMode === 'files'` and focus is outside inputs/editors. On a scrolling landing page this hijacks arrow-key scrolling; needs a demo guard.
- `src/components/Canvas/nodes/CodeNode.tsx`: `saveToFile` (~lines 205-224) calls `getPlatform().fs.writeFile`. `data.headOverride: string` provides the diff base with no git calls (`useHeadContent` returns it directly). `data.readOnly: true` makes the node permanently read-only.
- `src/store/git.ts` types: `GitFileStatus { path, status, insertions, deletions }`, `workingDiff: ReviewFile[]` where `ReviewFile { path, status, insertions, deletions, hunks: { start_line, line_count }[] }`, `headContent: { sha, files: Record<string,string> }`.
- `src/store/review.ts`: actions (`acceptHunk`, `addComment`, ...) are pure store mutations; persistence writes via `platform.storage.setSync` (localStorage on browser platform). `ensureReviewSession` uses `gitStore.log[0].hash`.
- `src/store/graph.ts`: `GraphFileNode { id, label, folder, language, inDegree, outDegree, score, isTestFile, lineCount, charCount }`, `GraphFileEdge { source, target }`. Seed `scanState: 'ready'`.
- Health data types: `Finding { type, severity, files, message, detail? }` (`src/services/structureAnalyzer.ts`), `FileMetrics { path, folder, layer, lineCount, inDegree, outDegree, isTest, hasTest, longestChainDepth }`, `FileChurn { path, commitCount, totalInsertions, totalDeletions, lastModified }` (seconds), `Hotspot { path, commitCount, lineCount, inDegree, churnScore, sizeScore, hotspotScore }`, `FileSizeInfo { path, lineCount, tokens, contextFraction, isRisky }`.
- `src/store/canvasHelpers.ts`: `Column { path, kind: 'directory' | 'file', nodes, edges, importRefs? }`; `positionColumnNodes(nodes, xOffset, yStart)` is exported and positions a column. `src/lib/canvasGeometry.ts`: `NODE_WIDTH = 180`, `NODE_H_GAP = 32`, `CANVAS_MARGIN = 60`.
- Node data shapes: `src/types/nodes.ts` (`FolderNodeData { label, path, isDirectory: true, childCount? }`, `FileNodeData { label, path, isTestFile? }`, `CodeNodeData { label, filePath, code, startLine, endLine, headOverride?, readOnly?, review? }`).
- `landing/demoCode.ts` exports `DEMO_FILE_PATH = 'src/net/fetchWithRetry.ts'`, `DEMO_HEAD`, `DEMO_AGENT` (strings). `POLYGLOT_TABS` and `PolyglotTab` get deleted with the Languages section.
- Tests: vitest configured in `vite.config.ts` (jsdom, globals, `src/**/*.test.{ts,tsx}` include, setup `src/test/setup.ts` mocks Tauri). NOTE: the include pattern only covers `src/`; tests for landing modules live in `src/test/` (see Task 2).
- Test commands: `yarn test` (run), `yarn lint`, `yarn fmt`. Commits run lint-staged + `tsc -b --noEmit` via husky.
- Past specs/plans in `docs/` are committed with `git add -f` (docs/ is gitignored).
- Existing demo components: `landing/components/LiveReviewDemo.tsx` (delete in Task 9), `landing/components/PolyglotDemo.tsx` (delete in Task 9).

## File structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/demoMode.ts` | Create | Process-wide demo flag: `setDemoMode`, `isDemoMode` |
| `src/test/demoMode.test.ts` | Create | Flag behavior |
| `src/views/Canvas.tsx` | Modify | Export `CanvasFlow` (add `export` keyword) |
| `src/components/Graph/index.tsx` | Modify | Demo guards: skip auto-scan, local selection on click |
| `src/hooks/useCanvasKeyboard.ts` | Modify | Demo guard: skip document-level fallback handler |
| `src/components/Canvas/nodes/CodeNode.tsx` | Modify | Demo guard: `saveToFile` short-circuits |
| `landing/demoData.ts` | Create | Fictional mini-repo dataset + `seedDemoStores()` |
| `src/test/landingDemoData.test.ts` | Create | Seeding correctness + internal consistency |
| `landing/downloads.ts` | Create | Stub artifact URLs + `detectOS()` |
| `src/test/landingDownloads.test.ts` | Create | OS detection mapping |
| `landing/main.tsx` | Modify | `initPlatform()` + demo mode + seeding before mount |
| `landing/components/CanvasDemo.tsx` | Create | Real CanvasFlow in a bounded box + autoplay |
| `landing/components/GraphDemo.tsx` | Create | Real Graph + autoplay selection |
| `landing/components/HealthDemo.tsx` | Create | Real Health + analyzing-to-ready beat |
| `landing/components/DemoBoundary.tsx` | Create | ErrorBoundary wrapper with quiet fallback card |
| `landing/LandingPage.tsx` | Rewrite | New section order, copy, download section |
| `landing/components/LiveReviewDemo.tsx` | Delete | Superseded by CanvasDemo |
| `landing/components/PolyglotDemo.tsx` | Delete | Section removed |
| `landing/demoCode.ts` | Modify | Drop `POLYGLOT_TABS`/`PolyglotTab`, keep DEMO_* exports |

---

### Task 1: Demo mode flag

**Files:**
- Create: `src/lib/demoMode.ts`
- Test: `src/test/demoMode.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/test/demoMode.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { isDemoMode, setDemoMode } from '@/lib/demoMode'

describe('demoMode', () => {
  beforeEach(() => setDemoMode(false))

  it('defaults to off', () => {
    expect(isDemoMode()).toBe(false)
  })

  it('turns on once set', () => {
    setDemoMode(true)
    expect(isDemoMode()).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/test/demoMode.test.ts`
Expected: FAIL (cannot resolve `@/lib/demoMode`)

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/demoMode.ts
// Demo mode mounts the real app views on the landing page against seeded
// stores. Guards the few code paths that touch Tauri or global input.
let demo = false

export function setDemoMode(on: boolean): void {
  demo = on
}

export function isDemoMode(): boolean {
  return demo
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/test/demoMode.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/demoMode.ts src/test/demoMode.test.ts
git commit -m "feat: demo mode flag for landing page demos"
```

---

### Task 2: Demo dataset and store seeding

**Files:**
- Create: `landing/demoData.ts`
- Modify: `vite.config.ts` (extend vitest include so `src/test/landingDemoData.test.ts` can import from `landing/`; the include already matches `src/**`, only the import path matters, no config change needed if the test lives in `src/test/`)
- Test: `src/test/landingDemoData.test.ts`

The dataset is one fictional TypeScript service repo, root `/demo/relay`, reused by all three demos. The agent-changed file is the existing `DEMO_FILE_PATH`/`DEMO_HEAD`/`DEMO_AGENT` from `landing/demoCode.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/test/landingDemoData.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEMO_ROOT,
  GRAPH_NODES,
  GRAPH_EDGES,
  HEALTH_DATA,
  buildCanvasSeed,
  seedDemoStores,
} from '../../landing/demoData'
import { DEMO_FILE_PATH } from '../../landing/demoCode'
import { useCanvasStore, useGraphStore, useHealthStore, useBrowserStore } from '@/store'
import { useGitStore } from '@/store/git'

describe('demo dataset consistency', () => {
  it('graph edges reference existing graph nodes', () => {
    const ids = new Set(GRAPH_NODES.map((n) => n.id))
    for (const e of GRAPH_EDGES) {
      expect(ids.has(e.source), e.source).toBe(true)
      expect(ids.has(e.target), e.target).toBe(true)
    }
  })

  it('health data references existing graph nodes', () => {
    const ids = new Set(GRAPH_NODES.map((n) => n.id))
    for (const f of HEALTH_DATA.findings) {
      for (const file of f.files) expect(ids.has(file), file).toBe(true)
    }
    for (const m of HEALTH_DATA.metrics) expect(ids.has(m.path), m.path).toBe(true)
    for (const h of HEALTH_DATA.hotspots) expect(ids.has(h.path), h.path).toBe(true)
  })

  it('canvas seed contains the agent-changed code node with a diff base', () => {
    const seed = buildCanvasSeed()
    const codeNode = seed.nodes.find((n) => n.type === 'codeNode')
    expect(codeNode).toBeDefined()
    expect(codeNode!.data.filePath).toBe(`${DEMO_ROOT}/${DEMO_FILE_PATH}`)
    expect(typeof codeNode!.data.headOverride).toBe('string')
  })

  it('all canvas nodes are positioned (no node at default origin overlap)', () => {
    const seed = buildCanvasSeed()
    const keys = new Set(seed.nodes.map((n) => `${n.position.x}:${n.position.y}`))
    expect(keys.size).toBe(seed.nodes.length)
  })
})

describe('seedDemoStores', () => {
  beforeEach(() => seedDemoStores())

  it('seeds browser root and matching canvas root column so initRoot is skipped', () => {
    expect(useBrowserStore.getState().rootPath).toBe(DEMO_ROOT)
    expect(useCanvasStore.getState().columns[0]?.path).toBe(DEMO_ROOT)
  })

  it('seeds graph as ready so Graph renders without scanning', () => {
    const g = useGraphStore.getState()
    expect(g.scanState).toBe('ready')
    expect(g.allNodes.length).toBeGreaterThan(8)
    expect(g.allEdges.length).toBeGreaterThan(8)
  })

  it('seeds health as ready with analyzedRoot matching rootPath so analyze() is skipped', () => {
    const h = useHealthStore.getState()
    expect(h.scanState).toBe('ready')
    expect(h.analyzedRoot).toBe(DEMO_ROOT)
    expect(h.findings.length).toBeGreaterThan(2)
    expect(h.metrics.length).toBeGreaterThan(8)
    expect(h.hotspots.length).toBeGreaterThan(2)
    expect(h.fileSizes.length).toBeGreaterThan(8)
  })

  it('seeds git so the demo file reads as modified', () => {
    const git = useGitStore.getState()
    expect(git.isGitRepo).toBe(true)
    expect(git.status?.files.some((f) => f.path === DEMO_FILE_PATH)).toBe(true)
    expect(git.workingDiff.some((f) => f.path === DEMO_FILE_PATH)).toBe(true)
    expect(git.log?.[0]?.hash).toBeTruthy()
  })

  it('focuses the changed file on the canvas', () => {
    const s = useCanvasStore.getState()
    expect(s.focusedNodeId).toBeTruthy()
    const focused = s.nodes.find((n) => n.id === s.focusedNodeId)
    expect(focused).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/test/landingDemoData.test.ts`
Expected: FAIL (cannot resolve `../../landing/demoData`)

- [ ] **Step 3: Implement `landing/demoData.ts`**

Structure (complete the literal data following these exact shapes; verify field names against the cited type definitions before committing):

```typescript
// landing/demoData.ts
// One fictional mini-repo ("relay", a small TS HTTP relay service) that all
// three landing demos render. Seeds the real zustand stores; no Tauri.
import type { Edge } from '@xyflow/react'
import { useBrowserStore, useCanvasStore, useGraphStore, useHealthStore } from '@/store'
import { useGitStore } from '@/store/git'
import { positionColumnNodes, type Column } from '@/store/canvasHelpers'
import { NODE_WIDTH, NODE_H_GAP, CANVAS_MARGIN } from '@/lib/canvasGeometry'
import type { AppNode } from '@/types/nodes'
import type { GraphFileNode, GraphFileEdge } from '@/store/graph'
import { DEMO_FILE_PATH, DEMO_HEAD, DEMO_AGENT } from './demoCode'

export const DEMO_ROOT = '/demo/relay'

// ---- graph ----------------------------------------------------------------
// 11 files. score = inDegree + outDegree must be consistent with GRAPH_EDGES.
export const GRAPH_NODES: GraphFileNode[] = [
  // id is repo-relative. language values come from LanguageId
  // ('typescript' for all files here). lineCount/charCount plausible.
  { id: 'src/index.ts', label: 'index.ts', folder: 'src', language: 'typescript', inDegree: 0, outDegree: 4, score: 4, isTestFile: false, lineCount: 88, charCount: 2640 },
  { id: 'src/api/client.ts', label: 'client.ts', folder: 'src/api', language: 'typescript', inDegree: 2, outDegree: 4, score: 6, isTestFile: false, lineCount: 412, charCount: 13190 },
  { id: 'src/api/routes.ts', label: 'routes.ts', folder: 'src/api', language: 'typescript', inDegree: 1, outDegree: 2, score: 3, isTestFile: false, lineCount: 164, charCount: 5240 },
  { id: 'src/net/fetchWithRetry.ts', label: 'fetchWithRetry.ts', folder: 'src/net', language: 'typescript', inDegree: 2, outDegree: 2, score: 4, isTestFile: false, lineCount: 61, charCount: 1830 },
  { id: 'src/net/http.ts', label: 'http.ts', folder: 'src/net', language: 'typescript', inDegree: 2, outDegree: 1, score: 3, isTestFile: false, lineCount: 132, charCount: 4220 },
  { id: 'src/net/backoff.ts', label: 'backoff.ts', folder: 'src/net', language: 'typescript', inDegree: 1, outDegree: 0, score: 1, isTestFile: false, lineCount: 34, charCount: 980 },
  { id: 'src/lib/log.ts', label: 'log.ts', folder: 'src/lib', language: 'typescript', inDegree: 5, outDegree: 0, score: 5, isTestFile: false, lineCount: 96, charCount: 2880 },
  { id: 'src/lib/config.ts', label: 'config.ts', folder: 'src/lib', language: 'typescript', inDegree: 3, outDegree: 1, score: 4, isTestFile: false, lineCount: 72, charCount: 2160 },
  { id: 'src/lib/queue.ts', label: 'queue.ts', folder: 'src/lib', language: 'typescript', inDegree: 1, outDegree: 1, score: 2, isTestFile: false, lineCount: 188, charCount: 6020 },
  { id: 'src/net/fetchWithRetry.test.ts', label: 'fetchWithRetry.test.ts', folder: 'src/net', language: 'typescript', inDegree: 0, outDegree: 1, score: 1, isTestFile: true, lineCount: 142, charCount: 4540 },
  { id: 'src/api/client.test.ts', label: 'client.test.ts', folder: 'src/api', language: 'typescript', inDegree: 0, outDegree: 1, score: 1, isTestFile: true, lineCount: 210, charCount: 6720 },
]

export const GRAPH_EDGES: GraphFileEdge[] = [
  { source: 'src/index.ts', target: 'src/api/client.ts' },
  { source: 'src/index.ts', target: 'src/api/routes.ts' },
  { source: 'src/index.ts', target: 'src/lib/config.ts' },
  { source: 'src/index.ts', target: 'src/lib/log.ts' },
  { source: 'src/api/client.ts', target: 'src/net/fetchWithRetry.ts' },
  { source: 'src/api/client.ts', target: 'src/net/http.ts' },
  { source: 'src/api/client.ts', target: 'src/lib/log.ts' },
  { source: 'src/api/client.ts', target: 'src/lib/queue.ts' },
  { source: 'src/api/routes.ts', target: 'src/api/client.ts' },
  { source: 'src/api/routes.ts', target: 'src/lib/log.ts' },
  { source: 'src/net/fetchWithRetry.ts', target: 'src/net/backoff.ts' },
  { source: 'src/net/fetchWithRetry.ts', target: 'src/lib/log.ts' },
  { source: 'src/net/http.ts', target: 'src/lib/log.ts' },
  { source: 'src/lib/config.ts', target: 'src/lib/queue.ts' },
  { source: 'src/net/fetchWithRetry.test.ts', target: 'src/net/fetchWithRetry.ts' },
  { source: 'src/api/client.test.ts', target: 'src/api/client.ts' },
]

// ---- health ---------------------------------------------------------------
export const HEALTH_DATA = {
  findings: [
    { type: 'circular-dependency' as const, severity: 'error' as const, files: ['src/api/routes.ts', 'src/api/client.ts'], message: 'Circular dependency between routes.ts and client.ts' },
    { type: 'large-file' as const, severity: 'warning' as const, files: ['src/api/client.ts'], message: 'client.ts is 412 lines; consider splitting transport and parsing' },
    { type: 'high-fan-in' as const, severity: 'info' as const, files: ['src/lib/log.ts'], message: 'log.ts is imported by 5 modules', detail: { count: 5 } },
    { type: 'missing-test' as const, severity: 'warning' as const, files: ['src/lib/queue.ts'], message: 'queue.ts has no matching test file' },
  ],
  metrics: [
    // one entry per non-test GRAPH_NODE plus the tests, layer per folder:
    // 'lib' for src/lib, 'services' for src/api and src/net, 'other' for src/index.ts.
    // inDegree/outDegree copied from GRAPH_NODES. hasTest true only for
    // fetchWithRetry.ts and client.ts. longestChainDepth 1-4 plausible.
    // ...complete for all 11 files
  ],
  churn: [
    // lastModified is in SECONDS. fetchWithRetry.ts has the highest commitCount (18).
    // Entries for fetchWithRetry.ts, client.ts, routes.ts, log.ts, queue.ts, config.ts.
  ],
  hotspots: [
    // hotspotScore must equal churnScore * sizeScore exactly.
    // Entries for fetchWithRetry.ts (highest, e.g. 0.9 * 0.6 = 0.54), client.ts, routes.ts, queue.ts.
  ],
  fileSizes: [
    // tokens roughly charCount / 4; client.ts isRisky: false (13k chars is ~3.3k tokens);
    // give queue.ts and client.ts the top contextFractions. One entry per file.
  ],
}

// ---- canvas ---------------------------------------------------------------
// Columns: root listing -> src listing -> src/net listing -> code node.
const COL_X = (i: number) => CANVAS_MARGIN + i * (NODE_WIDTH + NODE_H_GAP)

export function buildCanvasSeed(): {
  columns: Column[]
  nodes: AppNode[]
  edges: Edge[]
  focusedNodeId: string
} {
  // Build each column's nodes (folder/file types per src/types/nodes.ts),
  // position them with positionColumnNodes(nodes, COL_X(i)), and connect
  // parent -> child with edges of type 'column' (matching the edge type
  // registered in src/views/Canvas.tsx). The last column holds one codeNode:
  //   { id: `code:${DEMO_ROOT}/${DEMO_FILE_PATH}`, type: 'codeNode',
  //     position: { x: COL_X(3), y: CANVAS_MARGIN },
  //     data: { label: 'fetchWithRetry.ts', filePath: `${DEMO_ROOT}/${DEMO_FILE_PATH}`,
  //             code: DEMO_AGENT, startLine: 1, endLine: DEMO_AGENT.split('\n').length,
  //             headOverride: DEMO_HEAD, review: { filePath: DEMO_FILE_PATH } } }
  // IMPORTANT: before finalizing, read how the app constructs column edges and
  // codeNode ids in src/store/canvasHelpers.ts (search for "codeNode" and the
  // edge construction) and mirror the exact id/edge conventions so focus and
  // keyboard navigation behave.
  // Return focusedNodeId = the FileNode id for fetchWithRetry.ts.
}

// Node ids the CanvasDemo autoplay script targets (Task 6).
export const DEMO_SCRIPT_IDS: { srcFolder: string; netFolder: string; changedFile: string } = {
  // assign the generated ids for the src folder node, the net folder node,
  // and the fetchWithRetry.ts file node
}

// ---- seeding --------------------------------------------------------------
export function seedDemoStores(): void {
  useBrowserStore.setState({ rootPath: DEMO_ROOT })

  const canvas = buildCanvasSeed()
  useCanvasStore.setState({
    columns: canvas.columns,
    nodes: canvas.nodes,
    edges: canvas.edges,
    focusedNodeId: canvas.focusedNodeId,
    currentColumnIndex: 2,
    depthChain: [DEMO_ROOT, `${DEMO_ROOT}/src`, `${DEMO_ROOT}/src/net`],
    viewportHeight: 600,
    mdPreviewEnabled: false,
    previewReady: true,
  })

  useGraphStore.setState({
    scanState: 'ready',
    scannedCount: GRAPH_NODES.length,
    errorMessage: null,
    allNodes: GRAPH_NODES,
    allEdges: GRAPH_EDGES,
  })

  const now = Date.now()
  useHealthStore.setState({
    scanState: 'ready',
    errorMessage: null,
    lastAnalyzedAt: now,
    progress: null,
    analyzedRoot: DEMO_ROOT,
    ...HEALTH_DATA,
  })

  useGitStore.setState({
    repoPath: DEMO_ROOT,
    initialized: true,
    isGitRepo: true,
    gitError: null,
    branch: { kind: 'branch', name: 'main' },
    branches: ['main'],
    lastCommitTimestamp: Math.floor(now / 1000) - 3600,
    log: [{ hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', message: 'feat: queue draining on shutdown', body: '', author: 'demo', timestamp: Math.floor(now / 1000) - 3600, insertions: 42, deletions: 7, files: [] }],
    headContent: { sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', files: { [DEMO_FILE_PATH]: DEMO_HEAD } },
    status: {
      files: [{ path: DEMO_FILE_PATH, status: 'M', insertions: 19, deletions: 6 }],
      total_insertions: 19,
      total_deletions: 6,
    },
    workingDiff: [{ path: DEMO_FILE_PATH, status: 'M', insertions: 19, deletions: 6, hunks: [{ start_line: 1, line_count: 12 }, { start_line: 24, line_count: 14 }] }],
    loading: false,
  })
}
```

Complete every `// ...complete` block with literal data. Verify exact store field names by reading `src/store/git.ts` (GitState), `src/store/health.ts`, `src/store/graph.ts` before running tests. Verify `GitLogEntry`, `GitBranch`, `GitStatus` shapes in `src/store/git.ts` and adjust the literals to match exactly.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/test/landingDemoData.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck and full suite**

Run: `yarn vitest run && npx tsc -b --noEmit`
Expected: PASS, no type errors

- [ ] **Step 6: Commit**

```bash
git add landing/demoData.ts src/test/landingDemoData.test.ts
git commit -m "feat: fictional demo repo dataset and store seeding for landing demos"
```

---

### Task 3: App-side demo guards

**Files:**
- Modify: `src/views/Canvas.tsx` (export CanvasFlow)
- Modify: `src/components/Graph/index.tsx` (skip auto-scan, demo selection)
- Modify: `src/hooks/useCanvasKeyboard.ts` (skip document-level handler)
- Modify: `src/components/Canvas/nodes/CodeNode.tsx` (saveToFile short-circuit)

These are behavior guards inside components; they are verified by the existing suite staying green, tsc, and the manual run in Task 10. Keep each guard to the smallest possible diff.

- [ ] **Step 1: Export CanvasFlow**

In `src/views/Canvas.tsx`, change `function CanvasFlow()` to `export function CanvasFlow()`. No other change.

- [ ] **Step 2: Guard the Graph auto-scan**

In `src/components/Graph/index.tsx`, import the flag and guard the scan effect (~lines 265-269):

```typescript
import { isDemoMode } from '@/lib/demoMode'
// ...
useEffect(() => {
  if (isDemoMode()) return
  if (!rootPath || rootPath === lastScannedRef.current) return
  lastScannedRef.current = rootPath
  void scan(rootPath)
}, [rootPath, scan])
```

- [ ] **Step 3: Demo selection in Graph**

In the same file, clicking a node currently calls `focusFileByPath(node.id)`, which navigates the canvas and reads the filesystem. In demo mode, hold the selection locally instead. Inside `GraphFlow`:

```typescript
const [demoSelection, setDemoSelection] = useState<string | null>(null)

const onNodeClick: NodeMouseHandler = useCallback(
  (_event, node) => {
    if (node.type === 'folderBg') return
    if (isDemoMode()) {
      setDemoSelection(node.id)
      return
    }
    void focusFileByPath(node.id)
  },
  [focusFileByPath],
)
```

And in the `selectedNodeId` memo, prefer the demo selection:

```typescript
const selectedNodeId = useMemo(() => {
  if (isDemoMode() && demoSelection && allNodes.some((n) => n.id === demoSelection)) {
    return demoSelection
  }
  if (canvasFocusedPath && allNodes.some((n) => n.id === canvasFocusedPath)) {
    return canvasFocusedPath
  }
  if (allNodes.length > 0) {
    return allNodes.reduce((best, n) => (n.score > best.score ? n : best), allNodes[0]).id
  }
  return null
}, [demoSelection, canvasFocusedPath, allNodes])
```

Read the actual current code first and keep its exact structure; only insert the demo branches.

- [ ] **Step 4: Guard the global keyboard fallback**

In `src/hooks/useCanvasKeyboard.ts`, at the top of `handleGlobalKeyDown` (~line 228):

```typescript
import { isDemoMode } from '@/lib/demoMode'
// ...
function handleGlobalKeyDown(e: KeyboardEvent) {
  if (isDemoMode()) return
  if (useViewStore.getState().viewMode !== 'files') return
  // ...existing body unchanged
```

The container-scoped handler stays active, so keyboard navigation still works when the visitor has clicked into the canvas demo.

- [ ] **Step 5: Guard saveToFile in CodeNode**

In `src/components/Canvas/nodes/CodeNode.tsx`, at the top of `saveToFile` (~line 205), after the existing early returns:

```typescript
import { isDemoMode } from '@/lib/demoMode'
// ...
if (isDemoMode()) {
  setDirty(false)
  return true
}
```

- [ ] **Step 6: Verify nothing regressed**

Run: `yarn vitest run && npx tsc -b --noEmit && yarn lint`
Expected: all pass. The guards are inert when `isDemoMode()` is false (the default), so no existing test may change.

- [ ] **Step 7: Commit**

```bash
git add src/views/Canvas.tsx src/components/Graph/index.tsx src/hooks/useCanvasKeyboard.ts src/components/Canvas/nodes/CodeNode.tsx
git commit -m "feat: demo mode guards so real views mount on the landing page"
```

---

### Task 4: Downloads module

**Files:**
- Create: `landing/downloads.ts`
- Test: `src/test/landingDownloads.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/test/landingDownloads.test.ts
import { describe, it, expect } from 'vitest'
import { detectOS, DOWNLOADS } from '../../landing/downloads'

describe('detectOS', () => {
  it.each([
    ['MacIntel', 'mac'],
    ['Win32', 'windows'],
    ['Linux x86_64', 'linux'],
    ['FreeBSD amd64', 'unknown'],
  ])('maps platform %s to %s', (platform, expected) => {
    expect(detectOS(platform)).toBe(expected)
  })
})

describe('DOWNLOADS', () => {
  it('has windows and mac artifact urls and a linux instruction command', () => {
    expect(DOWNLOADS.windows.url).toMatch(/^https?:\/\//)
    expect(DOWNLOADS.mac.url).toMatch(/^https?:\/\//)
    expect(DOWNLOADS.linux.appImageUrl).toMatch(/^https?:\/\//)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/test/landingDownloads.test.ts`
Expected: FAIL (cannot resolve `../../landing/downloads`)

- [ ] **Step 3: Implement**

```typescript
// landing/downloads.ts
// Stub artifact URLs until release hosting exists. Swap in one place.
export type OS = 'mac' | 'windows' | 'linux' | 'unknown'

export const DOWNLOADS = {
  windows: { label: 'Download for Windows', url: 'https://downloads.cotect.dev/cotect-setup.exe' },
  mac: { label: 'Download for macOS', url: 'https://downloads.cotect.dev/cotect.dmg' },
  linux: { appImageUrl: 'https://downloads.cotect.dev/cotect.AppImage' },
} as const

export function detectOS(platform?: string): OS {
  const p = platform ?? (typeof navigator !== 'undefined' ? navigator.platform : '')
  if (/mac/i.test(p)) return 'mac'
  if (/win/i.test(p)) return 'windows'
  if (/linux/i.test(p)) return 'linux'
  return 'unknown'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/test/landingDownloads.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add landing/downloads.ts src/test/landingDownloads.test.ts
git commit -m "feat: download constants and OS detection for landing page"
```

---

### Task 5: Landing entry initialization

**Files:**
- Modify: `landing/main.tsx`

- [ ] **Step 1: Rewrite the entry to initialize platform, demo mode, and seeds before mounting**

Read the current `landing/main.tsx` first (it appends the favicon manually because publicDir is off; keep that). New flow:

```typescript
import { createRoot } from 'react-dom/client'
import './landing.css'
import iconUrl from '../public/icon.svg'
import { initPlatform } from '@/services/platform'
import { setDemoMode } from '@/lib/demoMode'
import { seedDemoStores } from './demoData'
import { LandingPage } from './LandingPage'

// ...existing favicon wiring stays...

async function start() {
  setDemoMode(true)
  await initPlatform() // browser platform; getPlatform() is safe afterwards
  seedDemoStores()
  createRoot(document.getElementById('root')!).render(<LandingPage />)
}

void start()
```

Verify the exact export name of `initPlatform` in `src/services/platform/index.ts` (it may be re-exported from `@/services/platform`). If the current entry wraps render in StrictMode, keep that.

- [ ] **Step 2: Verify the page still renders**

Run: `yarn landing:dev` (background), then load http://localhost:5173 in headless Chrome and confirm the existing page renders with no console errors.

- [ ] **Step 3: Commit**

```bash
git add landing/main.tsx
git commit -m "feat: landing entry boots demo mode and seeds stores"
```

---

### Task 6: Canvas demo section component

**Files:**
- Create: `landing/components/DemoBoundary.tsx`
- Create: `landing/components/CanvasDemo.tsx`

- [ ] **Step 1: Create the shared error boundary wrapper**

```tsx
// landing/components/DemoBoundary.tsx
import { Component, type ReactNode } from 'react'

export class DemoBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="rounded-lg border border-border bg-card/40 p-8 text-center font-mono text-sm text-muted-foreground">
          demo failed to load. the desktop app still works.
        </div>
      )
    }
    return this.props.children
  }
}
```

(The app's `src/components/ErrorBoundary.tsx` renders a full-screen error card with stack traces; that is wrong for a landing section, hence this small local one.)

- [ ] **Step 2: Create CanvasDemo**

```tsx
// landing/components/CanvasDemo.tsx
import { useEffect, useRef, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { CanvasFlow } from '@/views/Canvas'
import { useCanvasStore } from '@/store'
import { useReviewStore } from '@/store/review'
import { DEMO_FILE_PATH } from '../demoCode'

/** Real CanvasFlow in a bounded box. Autoplays once when scrolled into view:
 *  walks focus across the seeded columns, then accepts the first hunk.
 *  Any pointer or key input inside the box cancels the script. */
export function CanvasDemo() {
  const boxRef = useRef<HTMLDivElement>(null)
  const [played, setPlayed] = useState(false)
  const cancelled = useRef(false)

  useEffect(() => {
    const el = boxRef.current
    if (!el || played) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        io.disconnect()
        setPlayed(true)
        runScript()
      },
      { threshold: 0.4 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [played])

  function runScript() {
    const steps: Array<[number, () => void]> = [
      // Walk focus through the seeded columns so the visitor sees navigation,
      // then accept hunk one in the review store so progress ticks.
      [600, () => useCanvasStore.getState().setFocus(/* src folder node id from demoData */)],
      [1400, () => useCanvasStore.getState().setFocus(/* net folder node id */)],
      [2200, () => useCanvasStore.getState().setFocus(/* fetchWithRetry.ts file node id */)],
      [3200, () => {
        const rs = useReviewStore.getState()
        // ensure a session exists, then accept the first hunk
        // (mirror ensureReviewSession from useReviewTarget: startReview with
        // gitStore.log[0].hash if rs.active is null)
        rs.acceptHunk(DEMO_FILE_PATH, /* first hunk start line from seeded workingDiff */ 1)
      }],
    ]
    for (const [t, fn] of steps) {
      setTimeout(() => {
        if (!cancelled.current) fn()
      }, t)
    }
  }

  const cancel = () => {
    cancelled.current = true
  }

  return (
    <div
      ref={boxRef}
      onPointerDownCapture={cancel}
      onKeyDownCapture={cancel}
      className="relative h-[560px] rounded-lg border border-border overflow-hidden bg-background"
    >
      <ReactFlowProvider>
        <CanvasFlow />
      </ReactFlowProvider>
    </div>
  )
}
```

Fill the node ids from `landing/demoData.ts` (export the ids it generates, or export named constants for the script's targets). Before finalizing, read `CanvasFlow` to confirm it renders correctly inside a non-fullscreen relative container; if it positions itself with `absolute inset-0`, the wrapper above already provides the containing block.

Export the autoplay target ids from `demoData.ts` as `export const DEMO_SCRIPT_IDS = { srcFolder, netFolder, changedFile }`.

- [ ] **Step 3: Smoke-check in the browser**

Temporarily render `<CanvasDemo />` in the existing `DemoSection` (or check after Task 9 wires it). Verify with headless Chrome: canvas renders multiple columns with edges, the code node shows the diff, dragging works, autoplay moves focus. Check the console for errors.

- [ ] **Step 4: Commit**

```bash
git add landing/components/DemoBoundary.tsx landing/components/CanvasDemo.tsx
git commit -m "feat: real-canvas landing demo with autoplay"
```

---

### Task 7: Graph demo section component

**Files:**
- Create: `landing/components/GraphDemo.tsx`

- [ ] **Step 1: Create GraphDemo**

The Graph view auto-selects the highest-score node when the canvas focus is not a graph file, so the initial render already shows an ego view with dependency and dependent edges. That IS the demo story; no scripted autoplay is needed here. The Task 3 demo-selection branch makes every visitor click re-center the ego view. Concretely:

```tsx
// landing/components/GraphDemo.tsx
import { Suspense, lazy } from 'react'

const Graph = lazy(() => import('@/components/Graph'))

export function GraphDemo() {
  return (
    <div className="relative h-[480px] rounded-lg border border-border overflow-hidden bg-background">
      <Suspense fallback={<div className="h-full animate-pulse bg-[#1e1e1e]" />}>
        <Graph />
      </Suspense>
    </div>
  )
}
```

No scripted autoplay for the graph: the default highest-score ego selection plus free clicking covers the story, and the Task 3 demo-selection branch makes every click work. (If, after mounting, the default render shows an empty state instead of the ego view, re-read the Graph selection memo and fix the seed, not the component.)

- [ ] **Step 2: Smoke-check in the browser**

Mount it (temporarily or after Task 9). Verify: graph renders nodes/edges, the hot node is selected with dependency edges visible, clicking another node re-centers the ego view, no console errors.

- [ ] **Step 3: Commit**

```bash
git add landing/components/GraphDemo.tsx
git commit -m "feat: real-graph landing demo"
```

---

### Task 8: Health demo section component

**Files:**
- Create: `landing/components/HealthDemo.tsx`

- [ ] **Step 1: Create HealthDemo**

Autoplay: hold the seeded data, present an "analyzing" beat first, then flip to ready. Both states are real store states the app itself passes through.

```tsx
// landing/components/HealthDemo.tsx
import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useHealthStore } from '@/store'
import { HEALTH_DATA, DEMO_ROOT } from '../demoData'

const Health = lazy(() => import('@/components/Health'))

export function HealthDemo() {
  const boxRef = useRef<HTMLDivElement>(null)
  const [played, setPlayed] = useState(false)

  useEffect(() => {
    const el = boxRef.current
    if (!el || played) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        io.disconnect()
        setPlayed(true)
        // Real intermediate state, then the seeded result.
        useHealthStore.setState({ scanState: 'analyzing', progress: 'Collecting file data...' })
        const t = setTimeout(() => {
          useHealthStore.setState({
            scanState: 'ready',
            progress: null,
            analyzedRoot: DEMO_ROOT,
            lastAnalyzedAt: Date.now(),
            ...HEALTH_DATA,
          })
        }, 1100)
        return
      },
      { threshold: 0.4 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [played])

  return (
    <div ref={boxRef} className="relative h-[560px] rounded-lg border border-border overflow-hidden bg-background">
      <Suspense fallback={<div className="h-full animate-pulse bg-[#1e1e1e]" />}>
        <Health />
      </Suspense>
    </div>
  )
}
```

Check `src/components/Health/index.tsx` for what it renders during `analyzing` (progress text) and make sure the auto-analyze effect cannot fire (it checks `analyzedRoot !== rootPath`; during the analyzing beat `analyzedRoot` is still DEMO_ROOT from seeding, so it stays inert; verify by reading the effect).

- [ ] **Step 2: Smoke-check in the browser**

Verify: analyzing beat plays, panel populates with findings/hotspots/metrics, table sorting works, file links do not throw (they call `navigateToFile`, pure store ops). No console errors.

- [ ] **Step 3: Commit**

```bash
git add landing/components/HealthDemo.tsx
git commit -m "feat: real-health landing demo with analyzing beat"
```

---

### Task 9: Rewrite LandingPage, delete dead sections

**Files:**
- Rewrite: `landing/LandingPage.tsx`
- Delete: `landing/components/LiveReviewDemo.tsx`, `landing/components/PolyglotDemo.tsx`
- Modify: `landing/demoCode.ts` (delete `POLYGLOT_TABS` and `PolyglotTab`; keep `DEMO_FILE_PATH`, `DEMO_HEAD`, `DEMO_AGENT`)

- [ ] **Step 1: Rewrite LandingPage.tsx**

Keep: `Reveal`, `HunkLabel`, `DemoFallback`, grain/hero-glow divs, `Nav` structure, `Hero` headline/copy/stat-line, `HowItWorks` steps, `Footer`. Remove every `CONTACT` mailto. New imports:

```tsx
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import logoUrl from '../public/logo.svg'
import iconUrl from '../public/icon.svg'
import { DOWNLOADS, detectOS } from './downloads'
import { DemoBoundary } from './components/DemoBoundary'

const CanvasDemo = lazy(() => import('./components/CanvasDemo').then((m) => ({ default: m.CanvasDemo })))
const GraphDemo = lazy(() => import('./components/GraphDemo').then((m) => ({ default: m.GraphDemo })))
const HealthDemo = lazy(() => import('./components/HealthDemo').then((m) => ({ default: m.HealthDemo })))
```

Nav: links become `#demo`, `#graph`, `#health`, `#download`; the green button text becomes `download` with `href="#download"`.

Hero: primary CTA unchanged (`try the live demo ↓` to `#demo`). Secondary CTA:

```tsx
function HeroDownloadButton() {
  const [os] = useState(() => detectOS())
  const label = os === 'mac' ? DOWNLOADS.mac.label : os === 'windows' ? DOWNLOADS.windows.label : 'download'
  const href = os === 'mac' ? DOWNLOADS.mac.url : os === 'windows' ? DOWNLOADS.windows.url : '#download'
  return (
    <a href={href} className="rounded-md border border-border px-5 py-2.5 font-mono text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
      {label.toLowerCase()}
    </a>
  )
}
```

Demo sections (each wrapped `Reveal` + `DemoBoundary` + `Suspense` with `DemoFallback`), exact copy:

Section `id="demo"`, hunk label `-0,0 +1,3 canvas`:
- h2: `This is not a screenshot.`
- p: `The canvas below is the real cotect editor, the same component the desktop app ships. It opened a small repository on its own. Now it is yours: drag the nodes, pan around, and review the change an agent just made to fetchWithRetry.ts.`
- amber hint: `hint: look closely at hunk two. nobody asked for more retries.`
- caption under demo: `read-only by default · live working tree · hunk-by-hunk review`

Section `id="graph"`, hunk label `import graph`:
- h2: `See the shape of the repository.`
- p: `cotect resolves imports across the codebase and draws the result. Click any file to see what it pulls in and what depends on it.`
- caption: `import resolution · dependency and dependent edges · test files marked`

Section `id="health"`, hunk label `codebase health`:
- h2: `Know where it hurts.`
- p: `Structural findings, churn hotspots and oversized files, computed from the repository itself. Sort the table and judge for yourself.`
- caption: `circular dependencies · hotspots · context window fit`

Download section `id="download"`, hunk label `download`:
- h2: `Download cotect.`
- p: `Free while in development. Point it at a repository and start reading.`
- Three cards in a `sm:grid-cols-3` grid (same card style as HowItWorks steps):
  - Windows: button linking `DOWNLOADS.windows.url`, text `Download for Windows`.
  - macOS: button linking `DOWNLOADS.mac.url`, text `Download for macOS`, small note: `unsigned build for now: right-click the app and choose Open on first launch.`
  - Linux: mono block with `curl -LO https://downloads.cotect.dev/cotect.AppImage`, `chmod +x cotect.AppImage`, `./cotect.AppImage` (render the URL from `DOWNLOADS.linux.appImageUrl`, do not hardcode twice).

HowItWorks: keep the three steps; the closing box keeps `merge and hope` / `review and know` but its button becomes `download` with `href="#download"`.

Final structure:

```tsx
export function LandingPage() {
  return (
    <div className="landing min-h-screen">
      <div className="grain" aria-hidden />
      <Nav />
      <main>
        <Hero />
        <CanvasSection />
        <GraphSection />
        <HealthSection />
        <HowItWorks />
        <DownloadSection />
      </main>
      <Footer />
    </div>
  )
}
```

- [ ] **Step 2: Delete dead files and exports**

```bash
git rm landing/components/LiveReviewDemo.tsx landing/components/PolyglotDemo.tsx
```

In `landing/demoCode.ts` remove `PolyglotTab` and `POLYGLOT_TABS` (and any now-unused language samples).

- [ ] **Step 3: Copy scrub**

Re-read every user-visible string in `landing/LandingPage.tsx` against the copy rule: no em dashes (the old hero/footer copy contains some; the strings listed above are already clean, but verify retained strings like the Hero paragraph, which currently uses non-breaking hyphens, those are fine), no "not X, it's Y" phrasing. `grep -n '—' landing/LandingPage.tsx` must return nothing.

- [ ] **Step 4: Verify**

Run: `yarn vitest run && npx tsc -b --noEmit && yarn lint`
Expected: PASS. Then `yarn landing:dev` and a headless Chrome pass over the full page: all sections render, console clean.

- [ ] **Step 5: Commit**

```bash
git add -A landing
git commit -m "feat: landing page with real canvas, graph and health demos plus downloads"
```

---

### Task 10: Full verification pass

**Files:** none new.

- [ ] **Step 1: Full test suite, typecheck, lint, formats**

Run: `yarn vitest run && npx tsc -b --noEmit && yarn lint && yarn fmt:check`
Expected: all pass (run `yarn fmt` first if fmt:check complains).

- [ ] **Step 2: Production landing build**

Run: `yarn landing:build`
Expected: builds without errors. Note the bundle warning sizes; the demos must stay lazy (check `dist-landing/assets` has separate chunks for the demo components).

- [ ] **Step 3: Drive the built page**

Run `yarn landing:preview` (or dev server) and with headless Chrome (`google-chrome --headless=new --no-sandbox --screenshot=... --window-size=1440,900 --virtual-time-budget=12000`):
- screenshot hero, canvas demo, graph demo, health demo, download section (tall screenshot + crops),
- confirm the canvas demo shows columns + edges + diff code node,
- confirm graph shows an ego selection,
- confirm health shows populated findings/metrics,
- `--dump-dom` and grep for Vite error overlay markers and uncaught error text,
- repeat at `--window-size=420,900` for mobile sanity (sections stack, demos do not overflow horizontally).

- [ ] **Step 4: Desktop app regression check**

Run: `yarn vite:build`
Expected: the app build still compiles (demo guards are inert without `setDemoMode(true)`).

- [ ] **Step 5: Commit any verification fixes**

```bash
git add -A
git commit -m "fix: landing demo polish from verification pass"
```

(Skip the commit if the working tree is clean.)
