import { create } from 'zustand'
import { createStoreWithHMR } from '@/lib/hmr'
import { getPlatform } from '@/services/platform'
import { HIDDEN_DIRECTORIES } from '@/lib/constants'
import { basename, toRepoRelative } from '@/lib/repoPath'
import { parseImports } from '@/services/treesitter'
import { resolveImport } from '@/services/importResolver'
import { isTestFile } from '@/lib/fileClassification'
import {
  PARSEABLE_EXTENSIONS,
  getConfigForFile,
  type LanguageId,
} from '@/services/treesitter-queries'

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
  lineCount: number
  charCount: number
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

  scan: (rootPath: string) => Promise<void>
}

function scoreNodes(nodes: GraphFileNode[], edges: GraphFileEdge[]): GraphFileNode[] {
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

function getExtension(path: string): string {
  const slash = path.lastIndexOf('/')
  const name = slash >= 0 ? path.slice(slash + 1) : path
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function getDirname(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(0, slash) : ''
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

export const useGraphStore = createStoreWithHMR(import.meta.hot, 'graph', () =>
  create<GraphState>((set) => ({
    scanState: 'idle',
    scannedCount: 0,
    errorMessage: null,
    allNodes: [],
    allEdges: [],

    scan: async (rootPath: string) => {
      set({ scanState: 'scanning', scannedCount: 0, errorMessage: null })

      try {
        const budget = { remaining: MAX_FILES }
        const absFiles = await collectParseableFiles(rootPath, budget, (count) => {
          set({ scannedCount: count })
        })
        const relFiles = absFiles.map((p) => toRepoRelative(p, rootPath))
        const knownFiles = new Set(relFiles)

        const platform = getPlatform()
        const importsByFile = new Map<string, string[]>()
        const lineCounts = new Map<string, number>()
        const charCounts = new Map<string, number>()
        // Tree-sitter parses synchronously on the main thread. A Promise.all
        // over the whole repo queues those parses back to back, starving
        // input and rendering for seconds right after project open (the
        // canvas froze for the first few movements). Small batches with a
        // real macrotask yield in between keep the app responsive while the
        // scan proceeds; MessageChannel avoids setTimeout's nested clamp.
        const yieldToMain = () =>
          new Promise<void>((resolve) => {
            const { port1, port2 } = new MessageChannel()
            port1.onmessage = () => resolve()
            port2.postMessage(null)
          })
        const BATCH = 8
        for (let start = 0; start < absFiles.length; start += BATCH) {
          await Promise.all(
            absFiles.slice(start, start + BATCH).map(async (abs, k) => {
              const rel = relFiles[start + k]
              try {
                const source = await platform.fs.readFile(abs)
                lineCounts.set(rel, source.split('\n').length)
                charCounts.set(rel, source.length)
                const specifiers = await parseImports(rel, source)
                importsByFile.set(rel, specifiers)
              } catch {
                importsByFile.set(rel, [])
                lineCounts.set(rel, 0)
                charCounts.set(rel, 0)
              }
            }),
          )
          await yieldToMain()
        }

        const rawNodes: GraphFileNode[] = relFiles.map((rel) => {
          const config = getConfigForFile(rel)
          const filename = basename(rel)
          return {
            id: rel,
            label: filename,
            folder: getDirname(rel),
            language: config?.id ?? 'typescript',
            inDegree: 0,
            outDegree: 0,
            score: 0,
            isTestFile: isTestFile(filename),
            lineCount: lineCounts.get(rel) ?? 0,
            charCount: charCounts.get(rel) ?? 0,
          }
        })

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

        set({
          scanState: 'ready',
          allNodes: scoredNodes,
          allEdges: edges,
        })
      } catch (err) {
        set({
          scanState: 'error',
          errorMessage: (err as Error).message ?? 'unknown error',
        })
      }
    },
  })),
)
