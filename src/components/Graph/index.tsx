import { useEffect, useState } from 'react'
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, type Node, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useBrowserStore } from '@/store'
import { getPlatform } from '@/services/platform'
import { HIDDEN_DIRECTORIES } from '@/lib/constants'
import { toRepoRelative } from '@/lib/repoPath'
import { parseImports } from '@/services/treesitter'

const proOptions = { hideAttribution: true }

const PARSEABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const RESOLVE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
// Cap so a giant monorepo doesn't freeze the UI on first activation. Beyond
// this many parseable files we stop scanning and surface a banner.
const MAX_FILES = 500

type ScanState =
  | { kind: 'idle' }
  | { kind: 'scanning'; scanned: number }
  | { kind: 'ready'; nodes: Node[]; edges: Edge[]; truncated: boolean; fileCount: number; edgeCount: number }
  | { kind: 'error'; message: string }

function getExtension(path: string): string {
  const slash = path.lastIndexOf('/')
  const name = slash >= 0 ? path.slice(slash + 1) : path
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function dirname(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(0, slash) : ''
}

/**
 * Resolve `./foo`-style relative imports to a concrete repo-relative path
 * within `knownFiles`. Bare specifiers (`react`, `@/x`) are returned as null
 * so callers can drop them — the graph only edges between in-repo files.
 */
function resolveImport(
  specifier: string,
  fromRel: string,
  knownFiles: Set<string>,
): string | null {
  if (!specifier.startsWith('.')) return null

  const baseDir = dirname(fromRel)
  // Normalize `./` and `../` against baseDir.
  const segments = (baseDir ? baseDir.split('/') : []).concat(specifier.split('/'))
  const stack: string[] = []
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (stack.length > 0) stack.pop()
      continue
    }
    stack.push(seg)
  }
  const resolved = stack.join('/')

  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = resolved + ext
    if (knownFiles.has(candidate)) return candidate
  }
  for (const ext of RESOLVE_EXTENSIONS) {
    if (ext === '') continue
    const candidate = `${resolved}/index${ext}`
    if (knownFiles.has(candidate)) return candidate
  }
  return null
}

async function collectParseableFiles(
  rootPath: string,
  budget: { remaining: number },
  onProgress: (count: number) => void,
): Promise<string[]> {
  const platform = getPlatform()
  const found: string[] = []
  const queue: string[] = [rootPath]

  while (queue.length > 0 && budget.remaining > 0) {
    const dir = queue.shift()!
    let entries
    try {
      entries = await platform.fs.readDirectory(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory) {
        if (HIDDEN_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue
        queue.push(entry.path)
      } else {
        const ext = getExtension(entry.name)
        if (!PARSEABLE_EXTENSIONS.has(ext)) continue
        if (budget.remaining <= 0) break
        budget.remaining--
        found.push(entry.path)
        if (found.length % 25 === 0) onProgress(found.length)
      }
    }
  }
  return found
}

async function buildGraphData(
  rootPath: string,
  onProgress: (count: number) => void,
): Promise<{ nodes: Node[]; edges: Edge[]; truncated: boolean }> {
  const budget = { remaining: MAX_FILES }
  const absFiles = await collectParseableFiles(rootPath, budget, onProgress)
  const truncated = absFiles.length >= MAX_FILES
  const relFiles = absFiles.map((p) => toRepoRelative(p, rootPath))
  const knownFiles = new Set(relFiles)

  const platform = getPlatform()
  const importsByFile = new Map<string, string[]>()
  await Promise.all(
    absFiles.map(async (abs, i) => {
      const rel = relFiles[i]
      try {
        const source = await platform.fs.readFile(abs)
        const specifiers = await parseImports(rel, source)
        importsByFile.set(rel, specifiers)
      } catch {
        importsByFile.set(rel, [])
      }
    }),
  )

  // Grid layout — simple, predictable, no extra deps. Sort alphabetically so
  // closely-related paths cluster visually.
  const sortedRel = [...relFiles].sort()
  const nodeByRel = new Map<string, Node>()
  const cols = Math.max(1, Math.ceil(Math.sqrt(sortedRel.length)))
  const cellW = 220
  const cellH = 60
  sortedRel.forEach((rel, i) => {
    const x = (i % cols) * cellW
    const y = Math.floor(i / cols) * cellH
    nodeByRel.set(rel, {
      id: rel,
      position: { x, y },
      data: { label: rel },
      style: {
        fontSize: 11,
        padding: '6px 10px',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        background: 'var(--color-card)',
        color: 'var(--color-foreground)',
        width: cellW - 20,
      },
    })
  })

  const edges: Edge[] = []
  for (const [from, specifiers] of importsByFile) {
    for (const spec of specifiers) {
      const target = resolveImport(spec, from, knownFiles)
      if (!target || target === from) continue
      edges.push({
        id: `${from}->${target}:${spec}`,
        source: from,
        target,
        style: { stroke: 'var(--color-muted-foreground)', strokeOpacity: 0.4, strokeWidth: 1 },
      })
    }
  }

  return { nodes: [...nodeByRel.values()], edges, truncated }
}

function GraphFlow() {
  const rootPath = useBrowserStore((s) => s.rootPath)
  const [state, setState] = useState<ScanState>({ kind: 'idle' })

  useEffect(() => {
    if (!rootPath) return
    // Captured-in-scope cancel flag — flipped by cleanup. Avoids reading
    // `tokenRef.current` in the cleanup (which lints as racy) while still
    // making any in-flight commits no-op on rapid rootPath churn.
    let cancelled = false

    void (async () => {
      try {
        if (cancelled) return
        setState({ kind: 'scanning', scanned: 0 })
        const { nodes, edges, truncated } = await buildGraphData(rootPath, (count) => {
          if (cancelled) return
          setState({ kind: 'scanning', scanned: count })
        })
        if (cancelled) return
        setState({ kind: 'ready', nodes, edges, truncated, fileCount: nodes.length, edgeCount: edges.length })
      } catch (err) {
        if (cancelled) return
        setState({ kind: 'error', message: (err as Error).message ?? 'unknown error' })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [rootPath])

  if (state.kind === 'idle' || !rootPath) {
    return <div className="flex items-center justify-center h-full text-sm text-muted-foreground">No project open</div>
  }
  if (state.kind === 'error') {
    return <div className="flex items-center justify-center h-full text-sm text-red-400">Graph build failed: {state.message}</div>
  }

  const showOverlay = state.kind === 'scanning' || (state.kind === 'ready' && state.fileCount === 0)

  return (
    <div className="absolute inset-0">
      {state.kind === 'ready' && (
        <ReactFlow
          nodes={state.nodes}
          edges={state.edges}
          colorMode="dark"
          proOptions={proOptions}
          nodesDraggable={true}
          nodesConnectable={false}
          elementsSelectable={false}
          minZoom={0.1}
          maxZoom={2}
          fitView
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={2} color="var(--color-foreground)" style={{ opacity: 0.1 }} />
        </ReactFlow>
      )}
      {showOverlay && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-background/80">
          {state.kind === 'scanning'
            ? `Scanning project... ${state.scanned} files`
            : 'No parseable source files found.'}
        </div>
      )}
      {state.kind === 'ready' && state.fileCount > 0 && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded bg-background/70 border border-border text-[11px] text-muted-foreground font-mono pointer-events-none">
          {state.fileCount} files · {state.edgeCount} imports
          {state.truncated && <span className="text-yellow-500"> · truncated at {MAX_FILES}</span>}
        </div>
      )}
    </div>
  )
}

export default function Graph() {
  return (
    <ReactFlowProvider>
      <GraphFlow />
    </ReactFlowProvider>
  )
}
