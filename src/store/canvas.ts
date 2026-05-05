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
import { getPlatform } from '@/services/platform'
import { HIDDEN_DIRECTORIES, NODE_WIDTH, NODE_HEIGHT, NODE_H_GAP, NODE_V_GAP, NODE_V_GAP_SMALL, CANVAS_PAD_Y, isImageFile, getImageMimeType, IMAGE_PREVIEW_MAX_BYTES } from '@/lib/constants'
import { clampY } from '@/lib/canvasCamera'
import { joinPath, toRepoRelative } from '@/lib/repoPath'
import type { AppNode } from '@/types/nodes'
import { withPersistence } from '@/store/persistence'
import { useGitStore } from '@/store/git'

function isTestFile(name: string): boolean {
  const lower = name.toLowerCase()
  if (/\.(test|spec)\.\w+$/.test(lower)) return true
  if (/[_-]test\.\w+$/.test(lower)) return true
  if (/^tests?\.\w+$/.test(lower)) return true
  if (/^(jest|vitest|karma|cypress|playwright)[.-]/.test(lower)) return true
  return false
}

export interface Column {
  path: string
  kind: 'directory' | 'file'
  nodes: AppNode[]
  edges: Edge[]
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

  // The "current" column is columns[currentColumnIndex]; all columns are rendered.
  columns: Column[]
  currentColumnIndex: number

  depthChain: string[]
  hiddenNodeIds: Set<string>
  codeNodeWidth: number

  // Memory of the last focused node per column path, recorded when navigating
  // left out of a column. On subsequent navigateRight into the same path we
  // restore that focus instead of landing on the first node. Entries persist
  // until initRoot — a 2L+2R round trip uses each entry exactly once and
  // leaves the user at the position they started from.
  rightFocusMemory: Record<string, string>

  viewportHeight: number

  // Kept in sync with pan-to-focus clamping so flattenAndRender can position
  // the preview column without waiting for the actual viewport animation.
  cameraY: number

  setViewportHeight: (h: number) => void
  setFocus: (nodeId: string | null) => void
  moveFocus: (direction: 'up' | 'down') => void
  navigateRight: () => Promise<void>
  navigateLeft: () => void
  navigateToColumn: (targetIndex: number) => void
  initRoot: (rootPath: string) => Promise<void>
  toggleHideNode: () => void
  setCodeNodeWidth: (width: number) => void
  updatePreview: () => Promise<void>
  focusFileByPath: (repoRelativePath: string) => Promise<void>
}

async function buildDirectoryNodes(dirPath: string): Promise<AppNode[]> {
  const platform = getPlatform()
  const rawEntries = await platform.fs.readDirectory(dirPath)
  const entries = rawEntries.filter((e) =>
    !e.isDirectory || (!HIDDEN_DIRECTORIES.has(e.name) && !e.name.startsWith('.'))
  )

  // Sort: folders first, then regular files, then test files — alphabetical within each group.
  const folders = entries.filter((e) => e.isDirectory).sort((a, b) => a.name.localeCompare(b.name))
  const regularFiles = entries.filter((e) => !e.isDirectory && !isTestFile(e.name)).sort((a, b) => a.name.localeCompare(b.name))
  const testFiles = entries.filter((e) => !e.isDirectory && isTestFile(e.name)).sort((a, b) => a.name.localeCompare(b.name))
  const sorted = [...folders, ...regularFiles, ...testFiles]

  const childCountMap = new Map<string, number>()
  await Promise.all(
    folders.map(async (folder) => {
      try {
        const children = await platform.fs.readDirectory(folder.path)
        const visible = children.filter((e) =>
          !e.isDirectory || (!HIDDEN_DIRECTORIES.has(e.name) && !e.name.startsWith('.'))
        )
        childCountMap.set(folder.path, visible.length)
      } catch {
        // Ignore unreadable directories
      }
    })
  )

  return sorted.map((entry): AppNode =>
    entry.isDirectory
      ? { id: entry.path, type: 'folder', position: { x: 0, y: 0 }, data: { label: entry.name, path: entry.path, isDirectory: true as const, childCount: childCountMap.get(entry.path) } }
      : { id: entry.path, type: 'file', position: { x: 0, y: 0 }, data: { label: entry.name, path: entry.path, isTestFile: isTestFile(entry.name) } }
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

  let binary = ''
  const len = bytes.length
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const base64 = btoa(binary)
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

  const sameCol = allNodes.filter((n) =>
    n.id !== focusedId && Math.abs(n.position.x - fx) < NODE_WIDTH * 0.5
  )

  let bestId: string | null = null
  let bestDist = Infinity

  for (const node of sameCol) {
    const dy = node.position.y - fy
    if (direction === 'up' && dy < 0 && Math.abs(dy) < bestDist) {
      bestDist = Math.abs(dy)
      bestId = node.id
    }
    if (direction === 'down' && dy > 0 && Math.abs(dy) < bestDist) {
      bestDist = Math.abs(dy)
      bestId = node.id
    }
  }

  return bestId
}

export const useCanvasStore = createStoreWithHMR(import.meta.hot, 'canvas', () => create<CanvasState>()(
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
  viewportHeight: 0,
  cameraY: CANVAS_PAD_Y,

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
    // Synchronously update node data (__isFocused flags) so the focus highlight
    // appears immediately, before the async preview loads.
    flattenAndRender(get, set)
    void get().updatePreview()
  },

  moveFocus: (direction) => {
    const { nodes, focusedNodeId } = get()
    if (nodes.length === 0) return

    if (!focusedNodeId) {
      if (nodes.length > 0) {
        set({ focusedNodeId: nodes[0].id })
        flattenAndRender(get, set)
        void get().updatePreview()
      }
      return
    }

    let nextId = findVerticalNeighbor(nodes, focusedNodeId, direction)

    // Wrap around to the opposite end of the column if no neighbor in direction.
    if (!nextId) {
      const focused = nodes.find((n) => n.id === focusedNodeId)
      if (focused) {
        const fx = focused.position.x
        const sameCol = nodes.filter(
          (n) => n.id !== focusedNodeId && Math.abs(n.position.x - fx) < NODE_WIDTH * 0.5,
        )
        if (sameCol.length > 0) {
          if (direction === 'down') {
            nextId = sameCol.reduce((best, n) => (n.position.y < best.position.y ? n : best)).id
          } else {
            nextId = sameCol.reduce((best, n) => (n.position.y > best.position.y ? n : best)).id
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

      const rootColumn: Column = { path: rootPath, kind: 'directory', nodes: dirNodes, edges: [] }

      set({
        columns: [rootColumn],
        currentColumnIndex: 0,
        depthChain: [rootPath],
        focusedNodeId: (dirNodes.find((n) => !get().hiddenNodeIds.has(n.id)) ?? dirNodes[0])?.id ?? null,
        cameraY: CANVAS_PAD_Y,
        rightFocusMemory: {},
      })

      flattenAndRender(get, set)
      void get().updatePreview()
    } catch (err) {
      console.error('Failed to init root:', err)
    }
  },

  focusFileByPath: async (repoRelativePath: string) => {
    const { columns } = get()
    const rootCol = columns[0]
    if (!rootCol) return
    const rootPath = rootCol.path

    const segments = repoRelativePath.split('/').filter(Boolean)
    if (segments.length === 0) return

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
        cameraY: CANVAS_PAD_Y,
      })

      flattenAndRender(get, set)
      void get().updatePreview()
    } catch (err) {
      console.warn('[canvas] focusFileByPath failed:', err)
    }
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
        cameraY: CANVAS_PAD_Y,
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
        cameraY: CANVAS_PAD_Y,
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
    const nextMemory = leavingCol && focusedNodeId
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
      cameraY: CANVAS_PAD_Y,
      rightFocusMemory: nextMemory,
    })

    flattenAndRender(get, set)
    void get().updatePreview()
  },

  navigateToColumn: (targetIndex) => {
    const { columns, currentColumnIndex, focusedNodeId, rightFocusMemory } = get()
    if (targetIndex === currentColumnIndex) return
    if (targetIndex < 0 || targetIndex >= columns.length) return

    if (targetIndex < currentColumnIndex) {
      const steps = currentColumnIndex - targetIndex
      for (let i = 0; i < steps; i++) get().navigateLeft()
      return
    }

    // Skipping updatePreview here is load-bearing: it would trim the
    // already-loaded ahead columns we want the user to keep clicking through.
    const targetCol = columns[targetIndex]
    const remembered = rightFocusMemory[targetCol.path]
    const restored = remembered && targetCol.nodes.some((n) => n.id === remembered)
      ? remembered
      : targetCol.nodes[0]?.id ?? null

    const leavingCol = columns[currentColumnIndex]
    const nextMemory = leavingCol && focusedNodeId
      ? { ...rightFocusMemory, [leavingCol.path]: focusedNodeId }
      : rightFocusMemory

    set({
      currentColumnIndex: targetIndex,
      focusedNodeId: restored,
      cameraY: CANVAS_PAD_Y,
      rightFocusMemory: nextMemory,
    })

    flattenAndRender(get, set)
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
        try {
          if (isImageFile(fileName)) {
            const imageNode = await buildImageNode(path)
            contentNode = imageNode ?? await buildFileNode(path)
          } else {
            contentNode = await buildFileNode(path)
          }
        } catch {
          contentNode = await buildHeadFallbackNode(path)
        }
        if (contentNode) {
          previewCol = { path, kind: 'file', nodes: [contentNode], edges: [] }
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
        hiddenNodeIds: {
          scope: 'project',
          serialize: (s: Set<string>) => [...s],
          deserialize: (raw: unknown) => new Set(raw as string[]),
        },
      },
      debounce: 500,
    },
  ),
))

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

/**
 * Flatten all columns into positioned nodes/edges and update the store for
 * ReactFlow. All columns are rendered so the user can pan freely with Space
 * to see the full navigation history; the Canvas view handles viewport
 * positioning so the current column appears right after the left panel.
 */
function flattenAndRender(
  get: () => CanvasState,
  set: (partial: Partial<CanvasState>) => void,
) {
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
  const focusedNodeY = focusedNodeId
    ? currentColPositioned?.yById.get(focusedNodeId) ?? 0
    : 0

  // Shares clampY with Canvas.tsx so the two never drift.
  const newCameraY = clampY(cameraY, focusedNodeY, viewportHeight)
  if (newCameraY !== cameraY) set({ cameraY: newCameraY })

  const previewYStart = Math.max(0, -newCameraY + CANVAS_PAD_Y)

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]
    const isCurrentCol = i === currentColumnIndex
    const isPreviewCol = i === currentColumnIndex + 1
    const xOffset = i * (NODE_WIDTH + NODE_H_GAP)
    const yStart = isPreviewCol ? previewYStart : 0

    const positioned = isCurrentCol && currentColPositioned
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

  set({ nodes: allNodes, edges: allEdges })
}
