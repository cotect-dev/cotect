import { create } from 'zustand'
import { createStoreWithHMR } from '@/lib/hmr'
import { getPlatform } from '@/services/platform'
import { HIDDEN_DIRECTORIES } from '@/lib/constants'
import { toRepoRelative } from '@/lib/repoPath'
import { parseImports } from '@/services/treesitter'
import { resolveImport } from '@/services/importResolver'
import { PARSEABLE_EXTENSIONS, getConfigForFile, type LanguageId } from '@/services/treesitter-queries'

export const DEFAULT_HUB_COUNT = 30
const MAX_FILES = 500

export interface GraphFileNode {
  id: string
  label: string
  folder: string
  language: LanguageId
  inDegree: number
  outDegree: number
  score: number
  isTestFile: boolean
}

export interface GraphFileEdge {
  source: string
  target: string
}

export type GraphScanState = 'idle' | 'scanning' | 'ready' | 'error'

interface GraphState {
  scanState: GraphScanState
  scannedCount: number
  errorMessage: string | null
  allNodes: GraphFileNode[]
  allEdges: GraphFileEdge[]
  selectedNodeId: string | null
  truncated: boolean

  setSelectedNodeId: (id: string | null) => void
  scan: (rootPath: string) => Promise<void>
}

/** Compute inDegree, outDegree, score for every node based on edges. */
export function scoreNodes(nodes: GraphFileNode[], edges: GraphFileEdge[]): GraphFileNode[] {
  const inDeg = new Map<string, number>()
  const outDeg = new Map<string, number>()
  for (const e of edges) {
    outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1)
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1)
  }
  return nodes.map((n) => {
    const ind = inDeg.get(n.id) ?? 0
    const outd = outDeg.get(n.id) ?? 0
    return { ...n, inDegree: ind, outDegree: outd, score: ind + outd }
  })
}

/** Pick which node IDs to render: top hubs or all. */
export function computeVisibleNodeIds(nodes: GraphFileNode[], showAll: boolean): Set<string> {
  if (showAll || nodes.length <= DEFAULT_HUB_COUNT) {
    return new Set(nodes.map((n) => n.id))
  }
  const sorted = [...nodes].sort((a, b) => b.score - a.score)
  return new Set(sorted.slice(0, DEFAULT_HUB_COUNT).map((n) => n.id))
}

function getExtension(path: string): string {
  const slash = path.lastIndexOf('/')
  const name = slash >= 0 ? path.slice(slash + 1) : path
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function getFilename(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(slash + 1) : path
}

function getDirname(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(0, slash) : ''
}

function isTestFile(name: string): boolean {
  const lower = name.toLowerCase()
  if (/\.(test|spec)\.\w+$/.test(lower)) return true
  if (/[_-]test\.\w+$/.test(lower)) return true
  if (/^tests?\.\w+$/.test(lower)) return true
  if (/^(jest|vitest|karma|cypress|playwright)[.-]/.test(lower)) return true
  return false
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

export const useGraphStore = createStoreWithHMR(import.meta.hot, 'graph', () => create<GraphState>((set) => ({
  scanState: 'idle',
  scannedCount: 0,
  errorMessage: null,
  allNodes: [],
  allEdges: [],
  selectedNodeId: null,
  truncated: false,

  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  scan: async (rootPath: string) => {
    set({ scanState: 'scanning', scannedCount: 0, errorMessage: null })

    try {
      const budget = { remaining: MAX_FILES }
      const absFiles = await collectParseableFiles(rootPath, budget, (count) => {
        set({ scannedCount: count })
      })
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

      // Build nodes
      const rawNodes: GraphFileNode[] = relFiles.map((rel) => {
        const config = getConfigForFile(rel)
        const filename = getFilename(rel)
        return {
          id: rel,
          label: filename,
          folder: getDirname(rel),
          language: config?.id ?? 'typescript',
          inDegree: 0,
          outDegree: 0,
          score: 0,
          isTestFile: isTestFile(filename),
        }
      })

      // Build edges
      const edges: GraphFileEdge[] = []
      const seen = new Set<string>()
      for (const [from, specifiers] of importsByFile) {
        const config = getConfigForFile(from)
        if (!config) continue
        for (const spec of specifiers) {
          const target = resolveImport(spec, from, knownFiles, config.id)
          if (!target || target === from) continue
          const key = `${from}->${target}`
          if (seen.has(key)) continue
          seen.add(key)
          edges.push({ source: from, target })
        }
      }

      const scoredNodes = scoreNodes(rawNodes, edges)

      // Auto-select the most connected file as the initial focus
      let topNodeId: string | null = null
      if (scoredNodes.length > 0) {
        topNodeId = scoredNodes.reduce((best, n) => n.score > best.score ? n : best, scoredNodes[0]).id
      }

      set({
        scanState: 'ready',
        allNodes: scoredNodes,
        allEdges: edges,
        selectedNodeId: topNodeId,
        truncated,
      })
    } catch (err) {
      set({
        scanState: 'error',
        errorMessage: (err as Error).message ?? 'unknown error',
      })
    }
  },
})))
