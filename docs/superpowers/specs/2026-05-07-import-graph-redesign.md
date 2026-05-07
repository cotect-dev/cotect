# Import Graph View Redesign

## Problem

View 2 (graph) is broken. It renders all parseable files in a flat alphabetical grid with import edges drawn between them. This produces an unreadable wall of boxes with spaghetti lines. It only supports JS/TS. It provides no meaningful insight into code structure.

## Goal

Replace view 2 with a force-directed dependency graph that shows which files depend on each other. Developers should be able to glance at it and immediately see tightly coupled clusters, entry points, and leaf modules. It must work across JS/TS, Python, Go, and Rust projects.

## Design

### Data Layer

#### Multi-language import parsing

Extend `src/services/treesitter.ts` and `src/services/treesitter-queries.ts`:

- **Existing:** JS (`.js`, `.jsx`, `.mjs`, `.cjs`) and TS (`.ts`, `.tsx`) via `tree-sitter-javascript.wasm` and `tree-sitter-typescript.wasm`
- **Add Python** (`.py`): `tree-sitter-python.wasm` — extract from `import_statement` and `import_from_statement` nodes
- **Add Go** (`.go`): `tree-sitter-go.wasm` — extract from `import_declaration` nodes
- **Add Rust** (`.rs`): `tree-sitter-rust.wasm` — extract from `use_declaration` nodes

Each language gets a dedicated `collectImportSpecifiers` variant in `treesitter-queries.ts` that walks the AST and returns raw specifier strings. The existing `collectImportSpecifiers` function is refactored to become the JS/TS variant.

`PARSEABLE_EXTENSIONS` in `Graph/index.tsx` expands to include `.py`, `.go`, `.rs`.

#### Import resolution

`resolveImport` becomes language-aware:

- **JS/TS (existing):** Relative paths (`./foo`) resolved against `knownFiles` with extension probing (`.ts`, `.tsx`, `.js`, etc.) and `/index.*` fallback. Bare specifiers (`react`, `@/x`) return null (external).
- **Python:** Relative imports (leading dots) resolved by dot-count as parent traversal. Absolute imports matched against repo-relative paths by converting dots to slashes. Module `__init__.py` is the index equivalent.
- **Go:** Import paths matched against repo-relative directory paths. Go imports are package-level (directory), so edges connect to the directory's files.
- **Rust:** `crate::` → repo root. `super::` → parent module. `self::` → current module. Path segments map to `<segment>.rs` or `<segment>/mod.rs`.

Non-resolvable specifiers (external packages, standard library) return null and produce no edge.

#### Graph data model

```typescript
interface GraphFileNode {
  id: string          // repo-relative path
  label: string       // filename only
  folder: string      // parent directory
  language: string    // 'ts' | 'js' | 'python' | 'go' | 'rust'
  inDegree: number    // count of files that import this file
  outDegree: number   // count of files this file imports
  score: number       // inDegree + outDegree (hub metric)
}

interface GraphFileEdge {
  source: string      // repo-relative path of importer
  target: string      // repo-relative path of imported file
}
```

### Layout

#### Force-directed via d3-force

Add `d3-force` as a dependency (~15KB).

The simulation runs once at graph build time (not continuously animated). It computes static `{x, y}` positions, then hands them to ReactFlow for rendering.

Forces:
- `forceLink` — edges pull connected nodes together
- `forceManyBody` — nodes repel (charge ~-200)
- `forceCenter` — keeps graph centered at origin
- `forceCollide` — prevents node overlap (radius based on node width)

Run ~300 ticks synchronously. For graphs under 500 nodes this completes in <100ms. The simulation produces positions; ReactFlow renders them with `fitView`.

#### Hub-based default view

Rather than showing all files (which becomes unreadable past ~50 files), the graph defaults to showing the top `DEFAULT_HUB_COUNT` (30) nodes ranked by `score` (inDegree + outDegree). If the total file count is ≤ `DEFAULT_HUB_COUNT`, all files are shown and the toggle is hidden. This surfaces:
- Entry points (high outDegree — they import many things)
- Utilities/shared modules (high inDegree — many files import them)
- Central coordinators (high both)

The full graph is always computed. Only rendering is filtered. A "Show all" toggle reveals everything and re-runs the simulation with all nodes.

### Rendering

#### Node appearance

- Small rounded rectangles: filename as label
- Color-coded by language:
  - Blue: TS/JS
  - Green: Python
  - Orange: Go
  - Red: Rust
- Hub nodes (top 10% by score) rendered slightly larger
- Folder shown as muted subtitle below filename
- Hover tooltip: full relative path, inDegree, outDegree

#### Edge appearance

- Thin semi-transparent bezier curves
- On node hover: direct edges brighten to full opacity, all other edges and nodes dim to ~10% opacity
- No arrowheads (reduces clutter; direction is implicit from clustering)

#### Stats badge

Bottom-left corner pill: `"{visible} of {total} files · {edgeCount} imports"`
- Language breakdown (e.g., "142 TS · 38 Py · 12 Go")
- Truncation warning if MAX_FILES cap hit

### Integration

#### Click to navigate

Clicking a graph node:
1. Calls `useViewStore.getState().setViewMode('files')`
2. Navigates the canvas store to the clicked file's path (reuses existing breadcrumb/column navigation)

The graph is a "find and jump" tool — all detailed file inspection happens in view 1.

#### State management

New `src/store/graph.ts` — a zustand store (using `createStoreWithHMR`):

```typescript
interface GraphState {
  scanState: 'idle' | 'scanning' | 'ready' | 'error'
  scannedCount: number
  errorMessage: string | null

  // Full computed graph
  allNodes: GraphFileNode[]
  allEdges: GraphFileEdge[]

  // View state
  showAll: boolean
  setShowAll: (show: boolean) => void

  // Derived (visible subset)
  visibleNodeIds: Set<string>

  // Actions
  scan: (rootPath: string) => Promise<void>
}
```

Re-scans when `rootPath` changes. Cached between view switches (graph isn't re-scanned when toggling 1↔2).

#### Breadcrumbs

Already rendered for `viewMode === 'graph'` (Canvas.tsx line 402). No changes needed.

#### Keyboard

`2` key already switches to graph view. No new bindings.

### New dependencies

- `d3-force` (layout simulation)
- `tree-sitter-python.wasm`, `tree-sitter-go.wasm`, `tree-sitter-rust.wasm` (placed in `public/` alongside existing WASM files)

### Files to create

- `src/store/graph.ts` — graph state store
- WASM grammar files in `public/`

### Files to modify

- `src/services/treesitter.ts` — add language loading for Python, Go, Rust
- `src/services/treesitter-queries.ts` — add per-language import extraction
- `src/components/Graph/index.tsx` — complete rewrite: force-directed layout, hub filtering, node styling, click-to-navigate
- `package.json` — add `d3-force` dependency

### Out of scope

- Continuous force simulation animation (positions are static after initial layout)
- In-graph editing or connection drawing
- Symbol-level nodes (functions, classes) — files only
- Manual node positioning or saved layouts
- Search/filter UI beyond "show all" toggle
