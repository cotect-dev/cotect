// src/store/browser.ts
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
      const content = await readFileContent(path)
      const analysis = await analyzeFile(path, content)

      const dir = path.substring(0, path.lastIndexOf('/'))
      const siblingAnalyses = new Map<string, FileAnalysis>()
      const dirEntries = await readDirectory(dir)
      for (const imp of analysis.imports) {
        if (!imp.resolvedPath) continue
        const candidates = [imp.resolvedPath, `${imp.resolvedPath}.ts`, `${imp.resolvedPath}.tsx`, `${imp.resolvedPath}.js`, `${imp.resolvedPath}.jsx`, `${imp.resolvedPath}/index.ts`, `${imp.resolvedPath}/index.tsx`]
        for (const candidate of candidates) {
          const found = dirEntries.find((e) => !e.isDirectory && e.path === candidate)
          if (found && !siblingAnalyses.has(candidate)) {
            try {
              const sibContent = await readFileContent(candidate)
              const sibAnalysis = await analyzeFile(candidate, sibContent)
              siblingAnalyses.set(candidate, sibAnalysis)
            } catch { /* file not readable */ }
            break
          }
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

    if (viewMode === 'directory') {
      const nodes: AppNode[] = entries.map((entry) => ({
        id: entry.path,
        type: entry.isDirectory ? 'folder' as const : 'file' as const,
        position: { x: 0, y: 0 },
        data: entry.isDirectory
          ? { label: entry.name, path: entry.path, isDirectory: true as const }
          : { label: entry.name, path: entry.path },
      }))
      return layoutTree(nodes, [])
    }

    if (viewMode === 'file' && fileAnalysis) {
      const nodes: AppNode[] = []
      const edges: Edge[] = []
      const fileId = `file:${currentPath}`

      for (const decl of fileAnalysis.declarations) {
        const nodeId = `${fileId}:${decl.name}`
        nodes.push({
          id: nodeId,
          type: decl.kind === 'class' ? 'classNode' : 'functionNode',
          position: { x: 0, y: 0 },
          data: { label: decl.name, kind: decl.kind, startLine: decl.startLine, endLine: decl.endLine },
        })

        for (const method of decl.children) {
          const methodId = `${nodeId}:${method.name}`
          nodes.push({
            id: methodId,
            type: 'functionNode',
            position: { x: 0, y: 0 },
            data: { label: method.name, kind: 'function', startLine: method.startLine, endLine: method.endLine, isMethod: true },
          })
          edges.push({
            id: `e-${nodeId}-${methodId}`,
            source: nodeId,
            target: methodId,
            type: 'smoothstep',
          })
        }
      }

      for (const imp of fileAnalysis.imports) {
        if (!imp.resolvedPath) continue
        const candidates = new Set([imp.resolvedPath, `${imp.resolvedPath}.ts`, `${imp.resolvedPath}.tsx`, `${imp.resolvedPath}.js`, `${imp.resolvedPath}.jsx`, `${imp.resolvedPath}/index.ts`, `${imp.resolvedPath}/index.tsx`])
        for (const [resolvedFile, sibAnalysis] of siblingAnalyses) {
          if (candidates.has(resolvedFile)) {
            const sibFileId = `sibling:${resolvedFile}`
            const fileName = resolvedFile.split('/').pop() || resolvedFile
            if (!nodes.find((n) => n.id === sibFileId)) {
              nodes.push({
                id: sibFileId,
                type: 'file',
                position: { x: 0, y: 0 },
                data: { label: fileName, path: resolvedFile, isImport: true, declarationCount: sibAnalysis.declarations.length },
              })
            }
            edges.push({
              id: `e-import-${fileId}-${sibFileId}`,
              source: nodes[0]?.id || fileId,
              target: sibFileId,
              type: 'smoothstep',
              animated: true,
              label: 'imports',
              style: { stroke: '#6366f1' },
            })
            break
          }
        }
      }

      return layoutTree(nodes, edges)
    }

    return { nodes: [], edges: [] }
  },
}))
