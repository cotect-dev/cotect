import { create } from 'zustand'
import { createStoreWithHMR } from '@/lib/hmr'
import {
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from '@xyflow/react'
import { invoke } from '@tauri-apps/api/core'
import { getPlatform } from '@/services/platform'
import {
  HIDDEN_DIRECTORIES,
  NODE_WIDTH,
  NODE_HEIGHT,
  NODE_H_GAP,
  NODE_V_GAP,
  NODE_V_GAP_SMALL,
  CANVAS_MARGIN,
  isImageFile,
  getImageMimeType,
  IMAGE_PREVIEW_MAX_BYTES,
} from '@/lib/constants'
import { clampY } from '@/lib/canvasCamera'
import { isTestFile } from '@/lib/fileClassification'
import { joinPath, toRepoRelative } from '@/lib/repoPath'
import type { AppNode } from '@/types/nodes'
import { withPersistence } from '@/store/persistence'
import { useGitStore } from '@/store/git'
import { parseImportsWithLines, parseImportsWithBindings } from '@/services/treesitter'
import { resolveImport } from '@/services/importResolver'
import { getConfigForFile } from '@/services/treesitter-queries'
import { useGraphStore } from '@/store/graph'

export type ImportRefKind = 'import' | 'imported-by'

export interface ImportRef {
  /** Repo-relative path of the resolved import target. */
  resolvedPath: string
  /** Display filename. */
  label: string
  /** 1-based source line number of the import/export statement. */
  line: number
  /**
   * 1-based visual line accounting for merge-view deleted chunks.
   * Same as `line` when no diff is active.
   */
  visualLine: number
  kind: ImportRefKind
  /** Names imported from this file (for imported-by refs), e.g. ['useStore', 'getData']. */
  importedNames?: string[]
}

export interface Column {
  path: string
  kind: 'directory' | 'file'
  nodes: AppNode[]
  edges: Edge[]
  /** Resolved import references for file preview columns. */
  importRefs?: ImportRef[]
}

export type CanvasState = {
  nodes: AppNode[]
  edges: Edge[]
  onNodesChange: OnNodesChange<AppNode>
  onEdgesChange: OnEdgesChange
  onConnect: OnConnect
  setNodes: (nodes: AppNode[]) => void
  setEdges: (edges: Edge[]) => void

  focusedNodeId: string | null

  columns: Column[]
  currentColumnIndex: number

  depthChain: string[]
  hiddenNodeIds: Set<string>
  codeNodeWidth: number

  rightFocusMemory: Record<string, string>
  viewportHeight: number
  cameraY: number
  lastOpenedFile: string | null
  fileHistory: string[]
  savedViewport: { x: number; y: number } | null
  mdPreviewEnabled: boolean

  setViewportHeight: (h: number) => void
  setFocus: (nodeId: string | null) => void
  moveFocus: (direction: 'up' | 'down') => void
  navigateRight: () => Promise<void>
  navigateLeft: () => void
  navigateToColumn: (targetIndex: number) => Promise<void>
  initRoot: (rootPath: string) => Promise<void>
  toggleHideNode: () => void
  setCodeNodeWidth: (width: number) => void
  updatePreview: () => Promise<void>
  focusFileByPath: (repoRelativePath: string) => Promise<void>
  navigateBack: () => Promise<void>
  showCommitDiff: (commitHash: string, filePath: string) => Promise<void>
}

async function buildDirectoryNodes(dirPath: string): Promise<AppNode[]> {
  const platform = getPlatform()
  const rawEntries = await platform.fs.readDirectory(dirPath)
  const entries = rawEntries.filter(
    (e) => !e.isDirectory || (!HIDDEN_DIRECTORIES.has(e.name) && !e.name.startsWith('.')),
  )

  const folders = entries.filter((e) => e.isDirectory).sort((a, b) => a.name.localeCompare(b.name))
  const regularFiles = entries
    .filter((e) => !e.isDirectory && !isTestFile(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))
  const testFiles = entries
    .filter((e) => !e.isDirectory && isTestFile(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))
  const sorted = [...folders, ...regularFiles, ...testFiles]

  const childCountMap = new Map<string, number>()
  await Promise.all(
    folders.map(async (folder) => {
      try {
        const children = await platform.fs.readDirectory(folder.path)
        const visible = children.filter(
          (e) => !e.isDirectory || (!HIDDEN_DIRECTORIES.has(e.name) && !e.name.startsWith('.')),
        )
        childCountMap.set(folder.path, visible.length)
      } catch {
        /* unreadable directory */
      }
    }),
  )

  return sorted.map(
    (entry): AppNode =>
      entry.isDirectory
        ? {
            id: entry.path,
            type: 'folder',
            position: { x: 0, y: 0 },
            data: {
              label: entry.name,
              path: entry.path,
              isDirectory: true as const,
              childCount: childCountMap.get(entry.path),
            },
          }
        : {
            id: entry.path,
            type: 'file',
            position: { x: 0, y: 0 },
            data: { label: entry.name, path: entry.path, isTestFile: isTestFile(entry.name) },
          },
  )
}

async function buildFileNode(filePath: string): Promise<AppNode> {
  const platform = getPlatform()
  const content = await platform.fs.readFile(filePath)
  const fileName = filePath.split('/').pop() || filePath
  const lineCount = content.split('\n').length

  return {
    id: `code:${filePath}:__full__`,
    type: 'codeNode',
    position: { x: 0, y: 0 },
    data: {
      label: fileName,
      filePath,
      code: content,
      startLine: 1,
      endLine: lineCount,
    },
  }
}

async function buildHeadFallbackNode(filePath: string): Promise<AppNode | null> {
  const { repoPath, loadHeadContent } = useGitStore.getState()
  if (!repoPath) return null
  const repoRel = toRepoRelative(filePath, repoPath)
  const headContent = await loadHeadContent(repoRel)
  if (headContent === null) return null
  const fileName = filePath.split('/').pop() || filePath
  const lineCount = headContent.split('\n').length
  return {
    id: `code:${filePath}:__head__`,
    type: 'codeNode',
    position: { x: 0, y: 0 },
    data: { label: fileName, filePath, code: headContent, startLine: 1, endLine: lineCount },
  }
}

/** Returns null if the image exceeds IMAGE_PREVIEW_MAX_BYTES. */
async function buildImageNode(filePath: string): Promise<AppNode | null> {
  const platform = getPlatform()
  const bytes = await platform.fs.readBinaryFile(filePath)
  const fileName = filePath.split('/').pop() || filePath

  if (bytes.length > IMAGE_PREVIEW_MAX_BYTES) {
    return null
  }

  const mime = getImageMimeType(fileName)

  const CHUNK = 8192
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)))
  }
  const base64 = btoa(chunks.join(''))
  const dataUrl = `data:${mime};base64,${base64}`

  return {
    id: `image:${filePath}`,
    type: 'imageNode',
    position: { x: 0, y: 0 },
    data: {
      label: fileName,
      filePath,
      dataUrl,
    },
  }
}

/**
 * Compute a visual-line map for a modified file: for each 0-based working-tree
 * line index, returns the 0-based visual line index accounting for deleted
 * HEAD-only lines that `unifiedMergeView` interleaves above it.
 */
function computeVisualLineMap(headContent: string, workingContent: string): number[] {
  const a = headContent.split('\n')
  const b = workingContent.split('\n')
  const n = a.length
  const m = b.length

  if (n > 2000 || m > 2000) return b.map((_, i) => i)

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  const headMatched = new Array(n).fill(false)
  const workMatched = new Array(m).fill(false)
  let i = n,
    j = m
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      headMatched[i - 1] = true
      workMatched[j - 1] = true
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }

  const visualMap: number[] = new Array(m)
  let hi = 0
  let deletedAbove = 0
  for (let wi = 0; wi < m; wi++) {
    if (workMatched[wi]) {
      while (hi < n && !headMatched[hi]) {
        deletedAbove++
        hi++
      }
      hi++ // consume the matched HEAD line
    }
    visualMap[wi] = wi + deletedAbove
  }
  return visualMap
}

async function resolveFileImportRefs(filePath: string, codeNode: AppNode): Promise<ImportRef[]> {
  if (codeNode.type !== 'codeNode') return []

  const gitState = useGitStore.getState()
  const { repoPath } = gitState
  if (!repoPath) return []

  const repoRel = toRepoRelative(filePath, repoPath)
  const config = getConfigForFile(repoRel)
  if (!config) return []

  const { allNodes, allEdges, scanState } = useGraphStore.getState()
  if (scanState !== 'ready' || allNodes.length === 0) return []

  const knownFiles = new Set(allNodes.map((n) => n.id))
  const source = codeNode.data.code

  let vmap: number[] | null = null
  const gitEntry = gitState.status?.files.find((f) => f.path === repoRel)
  if (gitEntry && gitEntry.status !== 'A' && gitEntry.status !== 'U') {
    const headContent = await gitState.loadHeadContent(repoRel)
    if (headContent !== null) {
      vmap = computeVisualLineMap(headContent, source)
    }
  }

  const toVisual = (srcLine: number) => {
    if (!vmap) return srcLine
    const idx = srcLine - 1
    return idx >= 0 && idx < vmap.length ? vmap[idx] + 1 : srcLine
  }

  const importLines = await parseImportsWithLines(repoRel, source)
  const refs: ImportRef[] = []
  const seen = new Set<string>()
  for (const imp of importLines) {
    const resolved = resolveImport(imp.specifier, repoRel, knownFiles, config.id)
    if (!resolved || resolved === repoRel) continue
    if (seen.has(resolved)) continue
    const label = resolved.split('/').pop() || resolved
    if (isTestFile(label)) continue
    seen.add(resolved)
    refs.push({
      resolvedPath: resolved,
      label,
      line: imp.line,
      visualLine: toVisual(imp.line),
      kind: 'import',
    })
  }

  const directImporters = allEdges
    .filter((e) => e.target === repoRel && e.source !== repoRel)
    .filter((e) => !isTestFile(e.source.split('/').pop() || e.source))
    .map((e) => e.source)

  if (directImporters.length > 0) {
    const sourceLines = source.split('\n')
    const exportMap = new Map<string, number>()
    let firstExportLine: number | null = null
    for (let li = 0; li < sourceLines.length; li++) {
      const trimmed = sourceLines[li].trimStart()
      if (!trimmed.startsWith('export ')) continue
      if (firstExportLine === null) firstExportLine = li + 1
      if (trimmed.includes(' from ')) continue // skip re-exports
      const m = trimmed.match(
        /^export\s+(?:declare\s+)?(?:default\s+)?(?:type|interface|const|let|var|function|async\s+function|class|enum|abstract\s+class)\s+(\w+)/,
      )
      if (m) exportMap.set(m[1], li + 1)
    }

    let fallbackAnchor = refs.length > 0 ? refs[refs.length - 1].line + 1 : 1
    if (exportMap.size > 0) {
      fallbackAnchor = Math.min(...exportMap.values())
    } else if (firstExportLine !== null) {
      fallbackAnchor = firstExportLine
    }

    const platform = getPlatform()
    const directBindings = await Promise.all(
      directImporters.map(async (imp): Promise<{ imp: string; names: string[] }> => {
        try {
          const absPath = joinPath(repoPath, imp)
          const impSource = await platform.fs.readFile(absPath)
          const impConfig = getConfigForFile(imp)
          if (!impConfig) return { imp, names: [] }
          const bindings = await parseImportsWithBindings(imp, impSource)
          const names: string[] = []
          for (const b of bindings) {
            const resolved = resolveImport(b.specifier, imp, knownFiles, impConfig.id)
            if (resolved === repoRel) names.push(...b.names)
          }
          return { imp, names }
        } catch {
          return { imp, names: [] }
        }
      }),
    )

    const exportedNames = new Set(exportMap.keys())
    const directImporterSet = new Set(directImporters)
    const transitiveBindings: { imp: string; names: string[] }[] = []

    for (const { imp: middleFile, names: middleNames } of directBindings) {
      const reExported = middleNames.filter((n) => exportedNames.has(n))
      if (reExported.length === 0) continue
      const reExportSet = new Set(reExported)

      const consumers = allEdges
        .filter(
          (e) =>
            e.target === middleFile && e.source !== repoRel && !directImporterSet.has(e.source),
        )
        .filter((e) => !isTestFile(e.source.split('/').pop() || e.source))
        .map((e) => e.source)

      if (consumers.length === 0) continue

      const resolved = await Promise.all(
        consumers.map(async (consumer): Promise<{ imp: string; names: string[] } | null> => {
          try {
            const absPath = joinPath(repoPath, consumer)
            const src = await platform.fs.readFile(absPath)
            const cfg = getConfigForFile(consumer)
            if (!cfg) return null
            const bindings = await parseImportsWithBindings(consumer, src)
            const matchedNames: string[] = []
            for (const b of bindings) {
              const res = resolveImport(b.specifier, consumer, knownFiles, cfg.id)
              if (res === middleFile) {
                matchedNames.push(...b.names.filter((n) => reExportSet.has(n)))
              }
            }
            return matchedNames.length > 0 ? { imp: consumer, names: matchedNames } : null
          } catch {
            return null
          }
        }),
      )

      for (const r of resolved) if (r) transitiveBindings.push(r)
    }

    const allBindings = [...directBindings, ...transitiveBindings]

    for (const { imp, names } of allBindings) {
      if (seen.has(imp)) continue
      seen.add(imp)
      const label = imp.split('/').pop() || imp

      const byLine = new Map<number, string[]>()
      for (const name of names) {
        const exportLine = exportMap.get(name)
        if (exportLine !== undefined) {
          if (!byLine.has(exportLine)) byLine.set(exportLine, [])
          byLine.get(exportLine)!.push(name)
        }
      }

      if (byLine.size > 0) {
        for (const [anchorLine, lineNames] of byLine) {
          refs.push({
            resolvedPath: imp,
            label,
            line: anchorLine,
            visualLine: toVisual(anchorLine),
            kind: 'imported-by',
            importedNames: lineNames,
          })
        }
      } else {
        refs.push({
          resolvedPath: imp,
          label,
          line: fallbackAnchor,
          visualLine: toVisual(fallbackAnchor),
          kind: 'imported-by',
          importedNames: names.length > 0 ? names : undefined,
        })
      }
    }
  }

  return refs
}

/**
 * Position nodes within a column. Larger gap at folder/file type boundaries.
 * Returns `yById` so callers can look up an arbitrary node's Y (e.g. the
 * focused-node camera-clamp pre-pass) without re-walking the gap rule.
 */
function positionColumnNodes(
  nodes: AppNode[],
  xOffset: number,
  yStart: number = 0,
): { positioned: AppNode[]; yById: Map<string, number> } {
  let y = yStart
  const yById = new Map<string, number>()
  const positioned = nodes.map((node, i) => {
    yById.set(node.id, y)
    const placed = { ...node, position: { x: xOffset, y } }
    const next = nodes[i + 1]
    const sameGroup = !next || (node.type === 'folder') === (next.type === 'folder')
    y += NODE_HEIGHT + (sameGroup ? NODE_V_GAP_SMALL : NODE_V_GAP)
    return placed
  })
  return { positioned, yById }
}

function findVerticalNeighbor(
  allNodes: AppNode[],
  focusedId: string,
  direction: 'up' | 'down',
): string | null {
  const focused = allNodes.find((n) => n.id === focusedId)
  if (!focused) return null

  const fx = focused.position.x
  const fy = focused.position.y

  const sameCol = allNodes.filter(
    (n) => n.id !== focusedId && Math.abs(n.position.x - fx) < NODE_WIDTH * 0.5,
  )

  let bestId: string | null = null
  let bestDist = Infinity

  for (const node of sameCol) {
    const dy = node.position.y - fy
    const inDirection = direction === 'up' ? dy < 0 : dy > 0
    if (inDirection && Math.abs(dy) < bestDist) {
      bestDist = Math.abs(dy)
      bestId = node.id
    }
  }

  return bestId
}

export const useCanvasStore = createStoreWithHMR(import.meta.hot, 'canvas', () =>
  create<CanvasState>()(
    withPersistence(
      (set, get) => ({
        nodes: [],
        edges: [],

        focusedNodeId: null,
        columns: [],
        currentColumnIndex: 0,
        depthChain: [],
        hiddenNodeIds: new Set(),
        codeNodeWidth: 650,
        rightFocusMemory: {},
        lastOpenedFile: null,
        fileHistory: [],
        viewportHeight: 0,
        cameraY: CANVAS_MARGIN,
        savedViewport: null,
        mdPreviewEnabled: false,

        onNodesChange: (changes) => {
          set({ nodes: applyNodeChanges(changes, get().nodes) })
        },

        onEdgesChange: (changes) => {
          set({ edges: applyEdgeChanges(changes, get().edges) })
        },

        onConnect: (connection) => {
          set({ edges: addEdge(connection, get().edges) })
        },

        setNodes: (nodes) => set({ nodes }),
        setEdges: (edges) => set({ edges }),

        setViewportHeight: (h) => set({ viewportHeight: h }),

        setFocus: (nodeId) => {
          set({ focusedNodeId: nodeId })
          flattenAndRender(get, set)
          void get().updatePreview()
        },

        moveFocus: (direction) => {
          const { nodes, focusedNodeId } = get()
          if (nodes.length === 0) return

          if (!focusedNodeId) {
            set({ focusedNodeId: nodes[0].id })
            flattenAndRender(get, set)
            void get().updatePreview()
            return
          }

          let nextId = findVerticalNeighbor(nodes, focusedNodeId, direction)

          if (!nextId) {
            const focused = nodes.find((n) => n.id === focusedNodeId)
            if (focused) {
              const fx = focused.position.x
              const sameCol = nodes.filter(
                (n) => n.id !== focusedNodeId && Math.abs(n.position.x - fx) < NODE_WIDTH * 0.5,
              )
              if (sameCol.length > 0) {
                if (direction === 'down') {
                  nextId = sameCol.reduce((best, n) =>
                    n.position.y < best.position.y ? n : best,
                  ).id
                } else {
                  nextId = sameCol.reduce((best, n) =>
                    n.position.y > best.position.y ? n : best,
                  ).id
                }
              }
            }
          }

          if (nextId) {
            set({ focusedNodeId: nextId })
            flattenAndRender(get, set)
            void get().updatePreview()
          }
        },

        initRoot: async (rootPath: string) => {
          try {
            const dirNodes = await buildDirectoryNodes(rootPath)

            const rootColumn: Column = {
              path: rootPath,
              kind: 'directory',
              nodes: dirNodes,
              edges: [],
            }

            const { lastOpenedFile } = get()

            set({
              columns: [rootColumn],
              currentColumnIndex: 0,
              depthChain: [rootPath],
              focusedNodeId:
                (dirNodes.find((n) => !get().hiddenNodeIds.has(n.id)) ?? dirNodes[0])?.id ?? null,
              cameraY: CANVAS_MARGIN,
              rightFocusMemory: {},
              fileHistory: [],
            })

            flattenAndRender(get, set)

            if (lastOpenedFile) {
              void get().focusFileByPath(lastOpenedFile)
            } else {
              void get().updatePreview()
            }

            const graphState = useGraphStore.getState()
            if (graphState.scanState === 'idle') {
              void graphState.scan(rootPath)
            }
          } catch (err) {
            console.error('Failed to init root:', err)
          }
        },

        focusFileByPath: async (repoRelativePath: string) => {
          const { columns, lastOpenedFile, fileHistory } = get()
          const rootCol = columns[0]
          if (!rootCol) return
          const rootPath = rootCol.path

          const segments = repoRelativePath.split('/').filter(Boolean)
          if (segments.length === 0) return

          const nextHistory =
            lastOpenedFile && lastOpenedFile !== repoRelativePath
              ? [...fileHistory, lastOpenedFile]
              : fileHistory

          let currentPath = rootPath
          const newColumns: Column[] = [rootCol]
          try {
            for (let i = 0; i < segments.length - 1; i++) {
              currentPath = joinPath(currentPath, segments[i])
              const dirNodes = await buildDirectoryNodes(currentPath)
              newColumns.push({ path: currentPath, kind: 'directory', nodes: dirNodes, edges: [] })
            }

            const parentCol = newColumns[newColumns.length - 1]
            const fileName = segments[segments.length - 1]
            const fileNodeId = joinPath(currentPath, fileName)
            let hasFile = parentCol.nodes.some((n) => n.id === fileNodeId)

            if (!hasFile) {
              const headFallback = await buildHeadFallbackNode(fileNodeId)
              if (headFallback) {
                parentCol.nodes = [
                  ...parentCol.nodes,
                  {
                    id: fileNodeId,
                    type: 'file',
                    position: { x: 0, y: 0 },
                    data: { label: fileName, path: fileNodeId },
                  },
                ]
                hasFile = true
              }
            }

            set({
              columns: newColumns,
              currentColumnIndex: newColumns.length - 1,
              depthChain: newColumns.map((c) => c.path),
              focusedNodeId: hasFile ? fileNodeId : null,
              cameraY: CANVAS_MARGIN,
              fileHistory: nextHistory,
            })

            flattenAndRender(get, set)
            void get().updatePreview()
          } catch (err) {
            console.warn('[canvas] focusFileByPath failed:', err)
          }
        },

        navigateBack: async () => {
          const { fileHistory } = get()
          if (fileHistory.length === 0) return
          const prev = fileHistory[fileHistory.length - 1]
          set({ fileHistory: fileHistory.slice(0, -1) })
          const saved = get().lastOpenedFile
          set({ lastOpenedFile: null })
          await get().focusFileByPath(prev)
          if (get().lastOpenedFile === null) set({ lastOpenedFile: saved })
        },

        showCommitDiff: async (commitHash, filePath) => {
          const { columns } = get()
          const rootCol = columns[0]
          if (!rootCol) return
          const repoPath = rootCol.path

          let afterContent: string
          try {
            afterContent = await invoke<string>('git_show_commit_file', {
              repoPath,
              hash: commitHash,
              filePath,
            })
          } catch {
            return
          }

          let beforeContent = ''
          try {
            beforeContent = await invoke<string>('git_show_commit_file', {
              repoPath,
              hash: `${commitHash}~1`,
              filePath,
            })
          } catch {
            /* file didn't exist in parent commit */
          }

          const fileName = filePath.split('/').pop() || filePath
          const lineCount = afterContent.split('\n').length
          const codeNode: AppNode = {
            id: `code:${repoPath}/${filePath}:${commitHash}`,
            type: 'codeNode',
            position: { x: 0, y: 0 },
            data: {
              label: fileName,
              filePath: joinPath(repoPath, filePath),
              code: afterContent,
              startLine: 1,
              endLine: lineCount,
              headOverride: beforeContent,
              readOnly: true,
              commitHash: commitHash,
            },
          }

          const previewCol: Column = {
            path: joinPath(repoPath, filePath),
            kind: 'file',
            nodes: [codeNode],
            edges: [],
          }

          const newColumns = [...columns.slice(0, 1), previewCol]
          set({
            columns: newColumns,
            currentColumnIndex: 0,
            focusedNodeId: null,
            cameraY: CANVAS_MARGIN,
          })

          flattenAndRender(get, set)
        },

        navigateRight: async () => {
          const { focusedNodeId, nodes, columns, currentColumnIndex, depthChain } = get()
          if (!focusedNodeId) return

          const node = nodes.find((n) => n.id === focusedNodeId)
          if (!node) return

          // Only folders can be navigated into — files are previewed in-place.
          if (node.type !== 'folder') return

          const nodeTargetPath = node.data.path

          const pickFocus = (newColNodes: AppNode[]): string | null => {
            const remembered = get().rightFocusMemory[nodeTargetPath]
            if (remembered && newColNodes.some((n) => n.id === remembered)) {
              return remembered
            }
            return newColNodes[0]?.id ?? null
          }

          // Promote an existing preview column if it matches; otherwise load fresh.
          const previewCol = columns[currentColumnIndex + 1]
          if (previewCol && previewCol.path === nodeTargetPath) {
            const newChain = [...depthChain.slice(0, currentColumnIndex + 1), nodeTargetPath]

            set({
              currentColumnIndex: currentColumnIndex + 1,
              depthChain: newChain,
              focusedNodeId: pickFocus(previewCol.nodes),
              cameraY: CANVAS_MARGIN,
            })

            flattenAndRender(get, set)
            void get().updatePreview()
            return
          }

          try {
            const path = node.data.path
            const dirNodes = await buildDirectoryNodes(path)
            const newColumn: Column = { path, kind: 'directory', nodes: dirNodes, edges: [] }

            const newColumns = [...columns.slice(0, currentColumnIndex + 1), newColumn]
            const newChain = [...depthChain.slice(0, currentColumnIndex + 1), path]

            set({
              columns: newColumns,
              currentColumnIndex: currentColumnIndex + 1,
              depthChain: newChain,
              focusedNodeId: pickFocus(dirNodes),
              cameraY: CANVAS_MARGIN,
            })

            flattenAndRender(get, set)
            void get().updatePreview()
          } catch (err) {
            console.error('Failed to navigate right:', err)
          }
        },

        navigateLeft: () => {
          const { columns, currentColumnIndex, focusedNodeId, rightFocusMemory } = get()
          if (currentColumnIndex <= 0) return

          const newIndex = currentColumnIndex - 1

          // Remember the focused node in the column we're leaving, keyed by that
          // column's path, so navigateRight can restore it on a return drill-in.
          const leavingCol = columns[currentColumnIndex]
          const nextMemory =
            leavingCol && focusedNodeId
              ? { ...rightFocusMemory, [leavingCol.path]: focusedNodeId }
              : rightFocusMemory

          // Restore focus in the parent column to the item that led to current.
          const currentColPath = leavingCol?.path
          const parentCol = columns[newIndex]
          let restoreFocusId: string | null = null

          if (parentCol && currentColPath) {
            const match = parentCol.nodes.find((n) => {
              if (n.type === 'folder' || n.type === 'file') return n.data.path === currentColPath
              return n.data.filePath === currentColPath
            })
            if (match) restoreFocusId = match.id
          }

          set({
            currentColumnIndex: newIndex,
            focusedNodeId: restoreFocusId || (parentCol?.nodes[0]?.id ?? null),
            cameraY: CANVAS_MARGIN,
            rightFocusMemory: nextMemory,
          })

          flattenAndRender(get, set)
          void get().updatePreview()
        },

        navigateToColumn: async (targetIndex) => {
          const { columns, currentColumnIndex, depthChain, focusedNodeId, rightFocusMemory } = get()
          if (targetIndex === currentColumnIndex) return
          if (targetIndex < 0 || targetIndex >= depthChain.length) return

          // Remember the focused node in the column we're leaving.
          const leavingCol = columns[currentColumnIndex]
          const nextMemory =
            leavingCol && focusedNodeId
              ? { ...rightFocusMemory, [leavingCol.path]: focusedNodeId }
              : rightFocusMemory

          // If columns exist up to the target we can jump directly; otherwise
          // we rebuild them from depthChain paths (columns may have been trimmed
          // by updatePreview after a previous navigateLeft).
          let targetColumns = columns
          if (targetIndex >= columns.length) {
            const rebuilt = [...columns]
            for (let i = columns.length; i <= targetIndex; i++) {
              const path = depthChain[i]
              if (!path) break
              try {
                const dirNodes = await buildDirectoryNodes(path)
                rebuilt.push({ path, kind: 'directory' as const, nodes: dirNodes, edges: [] })
              } catch {
                break
              }
            }
            targetColumns = rebuilt
            // Bail if we couldn't rebuild far enough.
            if (targetIndex >= targetColumns.length) return
          }

          const targetCol = targetColumns[targetIndex]
          const remembered = nextMemory[targetCol.path]
          const restored =
            remembered && targetCol.nodes.some((n) => n.id === remembered)
              ? remembered
              : (targetCol.nodes[0]?.id ?? null)

          set({
            columns: targetColumns,
            currentColumnIndex: targetIndex,
            focusedNodeId: restored,
            cameraY: CANVAS_MARGIN,
            rightFocusMemory: nextMemory,
          })

          flattenAndRender(get, set)
          void get().updatePreview()
        },

        toggleHideNode: () => {
          const { focusedNodeId, hiddenNodeIds } = get()
          if (!focusedNodeId) return

          const next = new Set(hiddenNodeIds)
          if (next.has(focusedNodeId)) {
            next.delete(focusedNodeId)
          } else {
            next.add(focusedNodeId)
          }
          set({ hiddenNodeIds: next })
          flattenAndRender(get, set)
        },

        setCodeNodeWidth: (width: number) => {
          set({ codeNodeWidth: width })
          flattenAndRender(get, set)
        },

        /**
         * Load a preview column for the focused node into columns[currentColumnIndex + 1].
         * Gives immediate feedback when moving focus with W/S — the right column
         * shows what pressing D would navigate into.
         */
        updatePreview: async () => {
          const { focusedNodeId, columns, currentColumnIndex } = get()
          if (!focusedNodeId) {
            const trimmed = columns.slice(0, currentColumnIndex + 1)
            if (trimmed.length !== columns.length) {
              set({ columns: trimmed })
              flattenAndRender(get, set)
            }
            return
          }

          const currentCol = columns[currentColumnIndex]
          if (!currentCol) return

          const node = currentCol.nodes.find((n) => n.id === focusedNodeId)
          if (!node) return

          try {
            let previewCol: Column | null = null

            if (node.type === 'folder') {
              const path = node.data.path
              const dirNodes = await buildDirectoryNodes(path)
              previewCol = { path, kind: 'directory', nodes: dirNodes, edges: [] }
            } else if (node.type === 'file') {
              const path = node.data.path
              const fileName = node.data.label
              let contentNode: AppNode | null = null
              let importRefs: ImportRef[] | undefined
              try {
                if (isImageFile(fileName)) {
                  const imageNode = await buildImageNode(path)
                  contentNode = imageNode ?? (await buildFileNode(path))
                } else {
                  contentNode = await buildFileNode(path)
                  // Resolve import references with line positions
                  importRefs = await resolveFileImportRefs(path, contentNode)
                }
              } catch {
                contentNode = await buildHeadFallbackNode(path)
              }
              if (contentNode) {
                previewCol = { path, kind: 'file', nodes: [contentNode], edges: [], importRefs }
                const { repoPath } = useGitStore.getState()
                if (repoPath) set({ lastOpenedFile: toRepoRelative(path, repoPath) })
              }
            }

            // Bail out if focus changed during the async load.
            if (get().focusedNodeId !== focusedNodeId) return

            if (previewCol) {
              const newColumns = [...columns.slice(0, currentColumnIndex + 1), previewCol]
              set({ columns: newColumns })
            } else {
              const trimmed = columns.slice(0, currentColumnIndex + 1)
              if (trimmed.length !== columns.length) {
                set({ columns: trimmed })
              }
            }

            flattenAndRender(get, set)
          } catch {
            // Silently ignore preview errors
          }
        },
      }),
      {
        name: 'canvas',
        fields: {
          codeNodeWidth: { scope: 'global' },
          mdPreviewEnabled: { scope: 'global' },
          lastOpenedFile: { scope: 'project' },
          hiddenNodeIds: {
            scope: 'project',
            serialize: (s: Set<string>) => [...s],
            deserialize: (raw: unknown) => new Set(raw as string[]),
          },
        },
        debounce: 500,
      },
    ),
  ),
)

// Persistence may hydrate hiddenNodeIds after initRoot has already rendered,
// so re-run flattenAndRender to reflect the restored hidden state.
let prevHiddenNodeIds = useCanvasStore.getState().hiddenNodeIds
useCanvasStore.subscribe((state) => {
  if (state.hiddenNodeIds !== prevHiddenNodeIds) {
    prevHiddenNodeIds = state.hiddenNodeIds
    if (state.columns.length > 0) {
      flattenAndRender(
        useCanvasStore.getState as () => CanvasState,
        useCanvasStore.setState as (partial: Partial<CanvasState>) => void,
      )
    }
  }
})

// Keep the graph in sync with disk additions/removals as surfaced by git
// status. Pure modifications (only `M` entries changing line counts) leave
// the path set untouched and are skipped, so this is essentially free when
// the user is just editing files.
let prevStatusPaths: Set<string> = new Set()
useGitStore.subscribe((state) => {
  const next = new Set((state.status?.files ?? []).map((f) => f.path))
  if (next.size === prevStatusPaths.size && [...next].every((p) => prevStatusPaths.has(p))) {
    return
  }

  const repoPath = state.repoPath
  if (!repoPath) {
    prevStatusPaths = next
    return
  }

  // Symmetric difference: paths added or removed since the previous tick.
  const changed: string[] = []
  for (const p of next) if (!prevStatusPaths.has(p)) changed.push(p)
  for (const p of prevStatusPaths) if (!next.has(p)) changed.push(p)
  prevStatusPaths = next
  if (changed.length === 0) return

  // For every changed path, every ancestor directory is potentially affected
  // — adding `a/b/c.txt` for the first time can introduce a new `b/` node
  // into column `a`, in addition to the obvious `a/b` listing change.
  const affected = new Set<string>([repoPath])
  for (const rel of changed) {
    const parts = rel.split('/').filter(Boolean)
    for (let i = 1; i < parts.length; i++) {
      affected.add(joinPath(repoPath, parts.slice(0, i).join('/')))
    }
  }

  void refreshDirectoryColumns(affected)
})

// Re-run updatePreview when the graph scan completes so import ref nodes
// appear once resolution data is available.
let prevGraphScanState = useGraphStore.getState().scanState
useGraphStore.subscribe((state) => {
  if (state.scanState === 'ready' && prevGraphScanState !== 'ready') {
    prevGraphScanState = state.scanState
    void useCanvasStore.getState().updatePreview()
  } else {
    prevGraphScanState = state.scanState
  }
})

/**
 * Rebuild any open directory column whose path is in `affected`. No-ops the
 * setState when the resulting node id set matches what's already cached, so
 * incidental status churn (staging, commit) doesn't trigger pointless renders.
 */
async function refreshDirectoryColumns(affected: Set<string>): Promise<void> {
  const { columns } = useCanvasStore.getState()
  const updates = await Promise.all(
    columns.map(async (col, index) => {
      if (col.kind !== 'directory') return null
      if (!affected.has(col.path)) return null
      try {
        const refreshed = await buildDirectoryNodes(col.path)
        const prevIds = new Set(col.nodes.map((n) => n.id))
        const sameSet =
          refreshed.length === prevIds.size && refreshed.every((n) => prevIds.has(n.id))
        return sameSet ? null : { index, nodes: refreshed }
      } catch {
        return null
      }
    }),
  )

  const realUpdates = updates.filter((u): u is { index: number; nodes: AppNode[] } => u !== null)
  if (realUpdates.length === 0) return

  // Re-read columns at apply time — navigation may have raced our async reads.
  const current = useCanvasStore.getState().columns
  const newColumns = current.map((col, i) => {
    const u = realUpdates.find((x) => x.index === i)
    if (!u) return col
    // Bail if the column at this index was swapped out (path changed) while
    // we were reading the directory; the rebuilt nodes belong to a stale path.
    if (current[i]?.path !== columns[i]?.path) return col
    return { ...col, nodes: u.nodes }
  })
  useCanvasStore.setState({ columns: newColumns })
  flattenAndRender(
    useCanvasStore.getState as () => CanvasState,
    useCanvasStore.setState as (partial: Partial<CanvasState>) => void,
  )
}

/**
 * Flatten all columns into positioned nodes/edges and update the store for
 * ReactFlow. All columns are rendered so the user can pan freely with Space
 * to see the full navigation history; the Canvas view handles viewport
 * positioning so the current column appears right after the left panel.
 */
function flattenAndRender(get: () => CanvasState, set: (partial: Partial<CanvasState>) => void) {
  const { columns, currentColumnIndex } = get()
  if (columns.length === 0) {
    set({ nodes: [], edges: [] })
    return
  }

  const allNodes: AppNode[] = []
  const allEdges: Edge[] = []

  const { focusedNodeId, hiddenNodeIds, viewportHeight, cameraY } = get()

  const orderColumn = (col: Column): AppNode[] => [
    ...col.nodes.filter((n) => !hiddenNodeIds.has(n.id)),
    ...col.nodes.filter((n) => hiddenNodeIds.has(n.id)),
  ]

  // Pre-pass on the current column feeds focusedNodeY for the camera clamp;
  // we reuse `.positioned` below so the column isn't walked twice.
  const currentColXOffset = currentColumnIndex * (NODE_WIDTH + NODE_H_GAP)
  const currentColPositioned = columns[currentColumnIndex]
    ? positionColumnNodes(orderColumn(columns[currentColumnIndex]), currentColXOffset, 0)
    : null
  const focusedNodeY = focusedNodeId ? (currentColPositioned?.yById.get(focusedNodeId) ?? 0) : 0

  // Shares clampY with Canvas.tsx so the two never drift.
  const newCameraY = clampY(cameraY, focusedNodeY, viewportHeight)
  if (newCameraY !== cameraY) set({ cameraY: newCameraY })

  const previewYStart = Math.max(0, -newCameraY + CANVAS_MARGIN)

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]
    const isCurrentCol = i === currentColumnIndex
    const isPreviewCol = i === currentColumnIndex + 1
    const xOffset = i * (NODE_WIDTH + NODE_H_GAP)
    const yStart = isPreviewCol ? previewYStart : 0

    const positioned =
      isCurrentCol && currentColPositioned
        ? currentColPositioned.positioned
        : positionColumnNodes(orderColumn(col), xOffset, yStart).positioned

    // Cast preserves the discriminated-union shape that spread loses in inference.
    for (const node of positioned) {
      allNodes.push({
        ...node,
        data: {
          ...node.data,
          __columnIndex: i,
          __isCurrent: isCurrentCol || (isPreviewCol && col.kind === 'file'),
          __isHidden: hiddenNodeIds.has(node.id),
          __isFocused: node.id === focusedNodeId,
        },
      } as AppNode)
    }

    for (const edge of col.edges) {
      allEdges.push({ ...edge })
    }
  }

  const { rightFocusMemory } = get()
  const edgeStyle = { stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1.5 }

  const findNodeByPath = (col: Column, path: string): string | null => {
    const match = col.nodes.find((n) => {
      if (n.type === 'folder' || n.type === 'file') return n.data.path === path
      return false
    })
    return match?.id ?? null
  }

  const resolveColumnFocus = (colIndex: number): string | null => {
    const col = columns[colIndex]
    if (!col || col.nodes.length === 0) return null
    if (colIndex === currentColumnIndex) return focusedNodeId
    if (col.kind === 'file') return col.nodes[0]?.id ?? null
    const remembered = rightFocusMemory[col.path]
    if (remembered && col.nodes.some((n) => n.id === remembered)) return remembered
    return findNodeByPath(col, columns[colIndex + 1]?.path ?? '') ?? col.nodes[0]?.id ?? null
  }

  for (let i = 0; i < columns.length - 1; i++) {
    const sourceId = resolveColumnFocus(i)
    const targetId = resolveColumnFocus(i + 1)
    if (!sourceId || !targetId) continue

    allEdges.push({
      id: `edge:col${i}:${sourceId}->${targetId}`,
      source: sourceId,
      sourceHandle: 'right',
      target: targetId,
      targetHandle: 'left',
      type: 'smoothstep',
      animated: true,
      style: edgeStyle,
    })
  }

  set({ nodes: allNodes, edges: allEdges })
}
