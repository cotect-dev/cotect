import { create } from 'zustand'
import type { Edge } from '@xyflow/react'
import { getPlatform, type FSEntry } from '@/services/platform'
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

const IMPORT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']

/** @internal Exported for testing only. */
export function resolveImportCandidates(basePath: string): string[] {
  return [basePath, ...IMPORT_EXTENSIONS.map((ext) => `${basePath}${ext}`)]
}

/** @internal Exported for testing only. */
export function findMatchingFile(resolvedPath: string, fileSet: Set<string>): string | undefined {
  return resolveImportCandidates(resolvedPath).find((c) => fileSet.has(c))
}

/** @internal Exported for testing only. */
export function generateDirectoryNodes(entries: FSEntry[]): { nodes: AppNode[]; edges: Edge[] } {
  const nodes: AppNode[] = entries.map((entry): AppNode =>
    entry.isDirectory
      ? { id: entry.path, type: 'folder', position: { x: 0, y: 0 }, data: { label: entry.name, path: entry.path, isDirectory: true as const } }
      : { id: entry.path, type: 'file', position: { x: 0, y: 0 }, data: { label: entry.name, path: entry.path } }
  )
  return layoutTree(nodes, [])
}

/** @internal Exported for testing only. */
export function generateFileNodes(
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

  // Track whether we need a file-level node as the import edge source
  let hasImportEdges = false

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
        hasImportEdges = true
        edges.push({
          id: `e-import-${fileId}-${sibFileId}`, source: fileId, target: sibFileId,
          type: 'smoothstep', animated: true, label: 'imports', style: { stroke: '#6366f1' },
        })
      }
      break
    }
  }

  // Add a file node as import edge source if needed
  if (hasImportEdges && !addedNodeIds.has(fileId)) {
    const fileName = currentPath.split('/').pop() || currentPath
    nodes.unshift({
      id: fileId, type: 'file', position: { x: 0, y: 0 },
      data: { label: fileName, path: currentPath },
    })
    // Connect declarations to the file node
    for (const decl of fileAnalysis.declarations) {
      const nodeId = `${fileId}:${decl.name}`
      edges.push({ id: `e-${fileId}-${nodeId}`, source: fileId, target: nodeId, type: 'smoothstep' })
    }
  }

  return layoutTree(nodes, edges)
}

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
      const entries = await getPlatform().fs.readDirectory(path)
      const state = get()
      const breadcrumbs: BreadcrumbEntry[] = [
        ...state.breadcrumbs.filter((b) => path.startsWith(b.path) && b.path !== path),
        { path, label: path.split('/').pop() || path, mode },
      ]
      set({ currentPath: path, viewMode: mode, entries, fileAnalysis: null, breadcrumbs, loading: false, siblingAnalyses: new Map() })
    } else {
      const [content, dirEntries] = await Promise.all([
        getPlatform().fs.readFile(path),
        getPlatform().fs.readDirectory(path.substring(0, path.lastIndexOf('/'))),
      ])
      const analysis = await analyzeFile(path, content)
      const dirFileSet = new Set(dirEntries.filter((e) => !e.isDirectory).map((e) => e.path))

      const importJobs: { resolvedFile: string }[] = []
      for (const imp of analysis.imports) {
        if (!imp.resolvedPath) continue
        const match = findMatchingFile(imp.resolvedPath, dirFileSet)
        if (match) importJobs.push({ resolvedFile: match })
      }

      const siblingAnalyses = new Map<string, FileAnalysis>()
      const results = await Promise.allSettled(
        importJobs.map(async ({ resolvedFile }) => {
          const sibContent = await getPlatform().fs.readFile(resolvedFile)
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
