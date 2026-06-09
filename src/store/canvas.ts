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
import { NODE_WIDTH, NODE_H_GAP, CANVAS_MARGIN } from '@/lib/canvasGeometry'
import { isImageFile } from '@/lib/fileClassification'
import { clampY } from '@/lib/canvasCamera'
import { basename, joinPath, toRepoRelative } from '@/lib/repoPath'
import type { AppNode } from '@/types/nodes'
import { withPersistence, waitForPersistence } from '@/store/persistence'
import { useGitStore } from '@/store/git'
import { useGraphStore } from '@/store/graph'
import {
  type ImportRef,
  type ImportRefKind,
  type Column,
  buildDirectoryNodes,
  buildFileNode,
  buildHeadFallbackNode,
  buildImageNode,
  resolveFileImportRefs,
  positionColumnNodes,
  findVerticalNeighbor,
} from './canvasHelpers'

export type { ImportRef, ImportRefKind, Column }

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
  previewReady: boolean
  /** Set by ref-pill clicks; consumed by CodeNode once the target editor mounts. */
  pendingScroll: { filePath: string; line: number } | null

  setViewportHeight: (h: number) => void
  setFocus: (nodeId: string | null) => void
  moveFocus: (direction: 'up' | 'down') => void
  navigateRight: () => Promise<void>
  navigateLeft: () => void
  navigateToColumn: (targetIndex: number) => Promise<void>
  initRoot: (rootPath: string) => Promise<void>
  toggleHideNode: () => void
  setCodeNodeWidth: (width: number) => void
  setPreviewReady: (ready: boolean) => void
  updatePreview: () => Promise<void>
  focusFileByPath: (repoRelativePath: string, scrollToLine?: number) => Promise<void>
  navigateBack: () => Promise<void>
  showCommitDiff: (commitHash: string, filePath: string) => Promise<void>
  showRangeDiff: (filePath: string, base: string, head: string) => Promise<void>
  setPendingScroll: (scroll: { filePath: string; line: number } | null) => void
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
        previewReady: true,
        pendingScroll: null,

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
          // Clicking a node that lives in a different column (e.g. the next /
          // preview column) must make that column current — otherwise
          // focusedNodeId points outside columns[currentColumnIndex], which
          // leaves the node highlighted-but-dimmed, breaks the inter-column
          // edge (it resolves to a node not in that column), and no-ops the
          // preview (updatePreview only looks in the current column).
          if (nodeId !== null) {
            const { columns, currentColumnIndex, depthChain } = get()
            const colIndex = columns.findIndex((c) => c.nodes.some((n) => n.id === nodeId))
            if (colIndex !== -1 && colIndex !== currentColumnIndex) {
              set({
                currentColumnIndex: colIndex,
                // Re-anchor the chain on the clicked column. Going forward this
                // commits the drilled-in column; going backward it drops the
                // abandoned forward branch. columns[colIndex].path already
                // equals depthChain[colIndex] for any drilled-through column.
                depthChain: [...depthChain.slice(0, colIndex), columns[colIndex].path],
                focusedNodeId: nodeId,
                cameraY: CANVAS_MARGIN,
              })
              flattenAndRender(get, set)
              void get().updatePreview()
              return
            }
          }

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
            const [dirNodes] = await Promise.all([
              buildDirectoryNodes(rootPath),
              waitForPersistence(),
            ])

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

        focusFileByPath: async (repoRelativePath: string, scrollToLine?: number) => {
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
              pendingScroll:
                scrollToLine !== undefined
                  ? { filePath: repoRelativePath, line: scrollToLine }
                  : null,
            })

            flattenAndRender(get, set)
            void get().updatePreview()
          } catch (err) {
            console.warn('[canvas] focusFileByPath failed:', err)
          }
        },

        setPendingScroll: (scroll) => set({ pendingScroll: scroll }),

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

          const [afterRes, beforeRes] = await Promise.allSettled([
            invoke<string>('git_show_commit_file', { repoPath, hash: commitHash, filePath }),
            invoke<string>('git_show_commit_file', {
              repoPath,
              hash: `${commitHash}~1`,
              filePath,
            }),
          ])
          if (afterRes.status === 'rejected') return
          const afterContent = afterRes.value
          // file didn't exist in parent commit → empty before-content
          const beforeContent = beforeRes.status === 'fulfilled' ? beforeRes.value : ''

          const fileName = basename(filePath)
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

        showRangeDiff: async (filePath, base, head) => {
          const { columns } = get()
          const rootCol = columns[0]
          if (!rootCol) return
          const repoPath = rootCol.path

          const [afterContent, beforeContent] = await Promise.all([
            // file deleted in range — show empty after-content
            invoke<string>('git_show_commit_file', { repoPath, hash: head, filePath }).catch(
              () => '',
            ),
            // file added in range — no base content
            invoke<string>('git_show_commit_file', { repoPath, hash: base, filePath }).catch(
              () => '',
            ),
          ])

          const fileName = basename(filePath)
          const lineCount = afterContent.split('\n').length
          const codeNode: AppNode = {
            id: `review:${repoPath}/${filePath}:${base}..${head}`,
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
              review: { filePath },
            },
          }

          const previewCol: Column = {
            path: joinPath(repoPath, filePath),
            kind: 'file',
            nodes: [codeNode],
            edges: [],
          }

          set({
            columns: [...columns.slice(0, 1), previewCol],
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

          if (node.type !== 'folder') return

          const nodeTargetPath = node.data.path

          const pickFocus = (newColNodes: AppNode[]): string | null => {
            const remembered = get().rightFocusMemory[nodeTargetPath]
            if (remembered && newColNodes.some((n) => n.id === remembered)) {
              return remembered
            }
            return newColNodes[0]?.id ?? null
          }

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

          const leavingCol = columns[currentColumnIndex]
          const nextMemory =
            leavingCol && focusedNodeId
              ? { ...rightFocusMemory, [leavingCol.path]: focusedNodeId }
              : rightFocusMemory

          // Columns may have been trimmed by updatePreview after a previous
          // navigateLeft, so rebuild from depthChain if needed.
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

        setPreviewReady: (ready: boolean) => {
          set({ previewReady: ready })
          flattenAndRender(get, set)
        },

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

            if (get().focusedNodeId !== focusedNodeId) return

            if (previewCol) {
              const newColumns = [...columns.slice(0, currentColumnIndex + 1), previewCol]
              const hasCodeNode =
                previewCol.kind === 'file' && previewCol.nodes.some((n) => n.type === 'codeNode')
              set({
                columns: newColumns,
                previewReady: !hasCodeNode,
              })
            } else {
              const trimmed = columns.slice(0, currentColumnIndex + 1)
              if (trimmed.length !== columns.length) {
                set({ columns: trimmed })
              }
            }

            flattenAndRender(get, set)
          } catch {
            /* ignored */
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

  const { previewReady } = get()

  for (let i = 0; i < columns.length - 1; i++) {
    const sourceId = resolveColumnFocus(i)
    const targetId = resolveColumnFocus(i + 1)
    if (!sourceId || !targetId) continue

    if (i === currentColumnIndex && !previewReady) continue

    const targetNode = columns[i + 1]?.nodes.find((n) => n.id === targetId)
    const isCodeTarget = targetNode?.type === 'codeNode'

    allEdges.push({
      id: `edge:col${i}:${sourceId}->${targetId}`,
      source: sourceId,
      sourceHandle: isCodeTarget ? 'rightTitle' : 'right',
      target: targetId,
      targetHandle: isCodeTarget ? 'title' : 'left',
      type: 'column',
      animated: true,
      style: edgeStyle,
    })
  }

  set({ nodes: allNodes, edges: allEdges })
}
