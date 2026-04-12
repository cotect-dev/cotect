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
import { HIDDEN_DIRECTORIES, NODE_WIDTH, NODE_HEIGHT, NODE_H_GAP, NODE_V_GAP, NODE_V_GAP_SMALL, CANVAS_PAD_Y, CANVAS_MARGIN, isImageFile, getImageMimeType, IMAGE_PREVIEW_MAX_BYTES } from '@/lib/constants'
import type { AppNode } from '@/types/nodes'
import { withPersistence } from '@/store/persistence'

/**
 * Returns true if a filename looks like a test/spec file.
 * Matches patterns like: *.test.ts, *.spec.js, test_foo.py, etc.
 */
function isTestFile(name: string): boolean {
  const lower = name.toLowerCase()
  // .test. or .spec. before the final extension
  if (/\.(test|spec)\.\w+$/.test(lower)) return true
  // _test. before the final extension (Go, Python conventions)
  if (/[_-]test\.\w+$/.test(lower)) return true
  // Files named exactly "test.*" or "tests.*"
  if (/^tests?\.\w+$/.test(lower)) return true
  // Common test config/setup files
  if (/^(jest|vitest|karma|cypress|playwright)[.-]/.test(lower)) return true
  return false
}

/**
 * A column represents one level in the navigation hierarchy.
 * Each column has a path and the nodes/edges for that level.
 */
export interface Column {
  path: string
  // 'directory' | 'file'
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

  // Focus management
  focusedNodeId: string | null

  // Column navigation state
  // All columns are rendered; the "current" column is columns[currentColumnIndex]
  columns: Column[]
  currentColumnIndex: number

  // The full depth chain of paths we've traversed (for breadcrumbs)
  depthChain: string[]

  // Hidden nodes: node IDs that have been hidden by the user (H key)
  hiddenNodeIds: Set<string>

  // Persisted width for code nodes (global preference)
  codeNodeWidth: number

  // Memory of the last focused node per column path, recorded when navigating
  // left out of a column. On subsequent navigateRight into the same path we
  // restore that focus instead of landing on the first node. Entries persist
  // until initRoot — a 2L+2R round trip uses each entry exactly once and
  // leaves the user at the position they started from.
  rightFocusMemory: Record<string, string>

  // The height of the canvas viewport in pixels (set by the view layer)
  viewportHeight: number

  // Simulated camera Y position (viewport.y), kept in sync with the
  // pan-to-focus clamping logic so flattenAndRender can position
  // the preview column without waiting for the actual viewport animation.
  cameraY: number

  // Actions
  setViewportHeight: (h: number) => void
  setFocus: (nodeId: string | null) => void
  moveFocus: (direction: 'up' | 'down') => void
  navigateRight: () => Promise<void>
  navigateLeft: () => void
  initRoot: (rootPath: string) => Promise<void>
  /** Toggle hide/show for the currently focused node. */
  toggleHideNode: () => void
  /** Set the width for all code nodes (persisted globally). */
  setCodeNodeWidth: (width: number) => void
  /** Load a preview column for the currently focused node (shown to the right). */
  updatePreview: () => Promise<void>
}

/**
 * Build directory-level nodes for a path: folders first, then files.
 * Returns unsorted; caller positions them.
 */
async function buildDirectoryNodes(dirPath: string): Promise<AppNode[]> {
  const platform = getPlatform()
  const rawEntries = await platform.fs.readDirectory(dirPath)
  const entries = rawEntries.filter((e) =>
    !e.isDirectory || (!HIDDEN_DIRECTORIES.has(e.name) && !e.name.startsWith('.'))
  )

  // Sort: folders first, then regular files, then test files — alphabetical within each group
  const folders = entries.filter((e) => e.isDirectory).sort((a, b) => a.name.localeCompare(b.name))
  const regularFiles = entries.filter((e) => !e.isDirectory && !isTestFile(e.name)).sort((a, b) => a.name.localeCompare(b.name))
  const testFiles = entries.filter((e) => !e.isDirectory && isTestFile(e.name)).sort((a, b) => a.name.localeCompare(b.name))
  const sorted = [...folders, ...regularFiles, ...testFiles]

  // Count children for each folder (fire and forget — counts loaded in parallel)
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

/**
 * Build a single code node containing the full file content.
 */
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

/**
 * Build an image preview node for an image file.
 * Reads the binary content and converts it to a base64 data URL.
 * Returns null if the image exceeds IMAGE_PREVIEW_MAX_BYTES.
 */
async function buildImageNode(filePath: string): Promise<AppNode | null> {
  const platform = getPlatform()
  const bytes = await platform.fs.readBinaryFile(filePath)
  const fileName = filePath.split('/').pop() || filePath

  if (bytes.length > IMAGE_PREVIEW_MAX_BYTES) {
    return null
  }

  const mime = getImageMimeType(fileName)

  // Convert bytes to base64
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
 * Position nodes within a column at a given X offset.
 * Uses a smaller gap between nodes of the same type group (folders, files)
 * and a larger gap at the boundary between type groups.
 */
function positionColumnNodes(nodes: AppNode[], xOffset: number, yStart: number = 0): AppNode[] {
  let y = yStart
  return nodes.map((node, i) => {
    const positioned = { ...node, position: { x: xOffset, y } }
    // Determine the gap after this node
    const next = nodes[i + 1]
    let gap = NODE_V_GAP_SMALL
    if (next) {
      const thisIsFolder = node.type === 'folder'
      const nextIsFolder = next.type === 'folder'
      if (thisIsFolder !== nextIsFolder) {
        gap = NODE_V_GAP // larger gap at type boundary
      }
    }
    y += NODE_HEIGHT + gap
    return positioned
  })
}

/**
 * Find the nearest node above or below the focused node within the same column X position.
 */
function findVerticalNeighbor(
  allNodes: AppNode[],
  focusedId: string,
  direction: 'up' | 'down',
): string | null {
  const focused = allNodes.find((n) => n.id === focusedId)
  if (!focused) return null

  const fx = focused.position.x
  const fy = focused.position.y

  // Only consider nodes in the same column (same X position, with small tolerance)
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
    // Synchronously update node data (__isFocused flags) so the visual
    // focus highlight appears immediately — before the async preview loads.
    flattenAndRender(get, set)
    // Fire-and-forget preview update
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

    // Wrap around: if no neighbor in direction, jump to the opposite end of the column
    if (!nextId) {
      const focused = nodes.find((n) => n.id === focusedNodeId)
      if (focused) {
        const fx = focused.position.x
        const sameCol = nodes.filter(
          (n) => n.id !== focusedNodeId && Math.abs(n.position.x - fx) < NODE_WIDTH * 0.5,
        )
        if (sameCol.length > 0) {
          if (direction === 'down') {
            // Wrap to topmost node in column
            nextId = sameCol.reduce((best, n) => (n.position.y < best.position.y ? n : best)).id
          } else {
            // Wrap to bottommost node in column
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

  /**
   * Initialize the canvas with the project root.
   * Column 0 = root directory contents.
   */
  initRoot: async (rootPath: string) => {
    try {
      const dirNodes = await buildDirectoryNodes(rootPath)

      const rootColumn: Column = { path: rootPath, kind: 'directory', nodes: dirNodes, edges: [] }

      set({
        columns: [rootColumn],
        currentColumnIndex: 0,
        depthChain: [rootPath],
        focusedNodeId: dirNodes.length > 0 ? dirNodes[0].id : null,
        cameraY: CANVAS_PAD_Y,
        rightFocusMemory: {},
      })

      // Flatten and position
      flattenAndRender(get, set)
      // Load preview for the first focused node
      void get().updatePreview()
    } catch (err) {
      console.error('Failed to init root:', err)
    }
  },

  /**
   * Navigate right (D key) — drill into the focused node.
   * If a preview column already exists for this node, promote it.
   * Otherwise load fresh.
   */
  navigateRight: async () => {
    const { focusedNodeId, nodes, columns, currentColumnIndex, depthChain } = get()
    if (!focusedNodeId) return

    const node = nodes.find((n) => n.id === focusedNodeId)
    if (!node) return

    // Only folders and files can be navigated into
    if (node.type !== 'folder' && node.type !== 'file') return

    const nodeTargetPath = node.data.path

    // Pick the focused child for a column we're moving into: prefer the
    // remembered node if we saw this path before, otherwise fall back to the
    // first node.
    const pickFocus = (newColNodes: AppNode[]): string | null => {
      const remembered = get().rightFocusMemory[nodeTargetPath]
      if (remembered && newColNodes.some((n) => n.id === remembered)) {
        return remembered
      }
      return newColNodes[0]?.id ?? null
    }

    // Check if we already have a preview column loaded for this node
    const previewCol = columns[currentColumnIndex + 1]
    if (previewCol && previewCol.path === nodeTargetPath) {
      // Promote the existing preview column — no need to re-fetch
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

    // No matching preview — load fresh
    try {
      if (node.type === 'folder') {
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
      } else {
        const path = node.data.path
        const fileName = node.data.label
        let contentNode: AppNode
        if (isImageFile(fileName)) {
          const imageNode = await buildImageNode(path)
          contentNode = imageNode ?? await buildFileNode(path)
        } else {
          contentNode = await buildFileNode(path)
        }
        const newColumn: Column = { path, kind: 'file', nodes: [contentNode], edges: [] }
        const newColumns = [...columns.slice(0, currentColumnIndex + 1), newColumn]
        const newChain = [...depthChain.slice(0, currentColumnIndex + 1), path]

        set({
          columns: newColumns,
          currentColumnIndex: currentColumnIndex + 1,
          depthChain: newChain,
          focusedNodeId: pickFocus(newColumn.nodes),
          cameraY: CANVAS_PAD_Y,
        })

        flattenAndRender(get, set)
        void get().updatePreview()
      }
    } catch (err) {
      console.error('Failed to navigate right:', err)
    }
  },

  /**
   * Navigate left (A key) — go back to parent column.
   */
  navigateLeft: () => {
    const { columns, currentColumnIndex, focusedNodeId, rightFocusMemory } = get()
    if (currentColumnIndex <= 0) return

    const newIndex = currentColumnIndex - 1

    // Remember which node was focused in the column we're leaving, keyed by
    // that column's path. navigateRight will restore it if the user drills
    // back into the same path.
    const leavingCol = columns[currentColumnIndex]
    const nextMemory = leavingCol && focusedNodeId
      ? { ...rightFocusMemory, [leavingCol.path]: focusedNodeId }
      : rightFocusMemory

    // Try to restore focus to the item in the parent column that led to the current column
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
    // Load preview for the restored focus
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
  },

  /**
   * Load a preview column for the currently focused node and place it
   * at columns[currentColumnIndex + 1]. This gives immediate feedback
   * when moving focus with W/S — the right column updates to show what
   * pressing D would navigate into.
   */
  updatePreview: async () => {
    const { focusedNodeId, columns, currentColumnIndex } = get()
    if (!focusedNodeId) {
      // No focus — remove any preview column
      const trimmed = columns.slice(0, currentColumnIndex + 1)
      if (trimmed.length !== columns.length) {
        set({ columns: trimmed })
        flattenAndRender(get, set)
      }
      return
    }

    // Find the focused node in the current column
    const currentCol = columns[currentColumnIndex]
    if (!currentCol) return

    const node = currentCol.nodes.find((n) => n.id === focusedNodeId)
    if (!node) {
      // Focused node is not in the current column — don't update preview
      return
    }

    try {
      let previewCol: Column | null = null

      if (node.type === 'folder') {
        const path = node.data.path
        const dirNodes = await buildDirectoryNodes(path)
        previewCol = { path, kind: 'directory', nodes: dirNodes, edges: [] }
      } else if (node.type === 'file') {
        const path = node.data.path
        const fileName = node.data.label
        let contentNode: AppNode
        if (isImageFile(fileName)) {
          const imageNode = await buildImageNode(path)
          contentNode = imageNode ?? await buildFileNode(path)
        } else {
          contentNode = await buildFileNode(path)
        }
        previewCol = { path, kind: 'file', nodes: [contentNode], edges: [] }
      }

      // Check that the focus hasn't changed while we were loading
      if (get().focusedNodeId !== focusedNodeId) return

      if (previewCol) {
        const newColumns = [...columns.slice(0, currentColumnIndex + 1), previewCol]
        set({ columns: newColumns })
      } else {
        // No preview available — trim any existing preview column
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

/**
 * Flatten all columns into positioned nodes and edges,
 * then update the store's nodes/edges for ReactFlow rendering.
 *
 * All columns are rendered so the user can pan freely with Space
 * to see the full navigation history. The Canvas view handles
 * viewport positioning so the current column appears right after
 * the left panel.
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

  // First pass: position the current column to find the focused node's Y.
  // This lets us compute where the camera will be after panning.
  let focusedNodeY = 0
  const currentCol = columns[currentColumnIndex]
  if (currentCol && focusedNodeId) {
    const visible = currentCol.nodes.filter((n) => !hiddenNodeIds.has(n.id))
    const hidden = currentCol.nodes.filter((n) => hiddenNodeIds.has(n.id))
    const ordered = [...visible, ...hidden]
    let y = 0
    for (let idx = 0; idx < ordered.length; idx++) {
      const node = ordered[idx]
      if (node.id === focusedNodeId) {
        focusedNodeY = y
        break
      }
      const nextNode = ordered[idx + 1]
      let gap = NODE_V_GAP_SMALL
      if (nextNode) {
        const thisIsFolder = node.type === 'folder'
        const nextIsFolder = nextNode.type === 'folder'
        if (thisIsFolder !== nextIsFolder) gap = NODE_V_GAP
      }
      y += NODE_HEIGHT + gap
    }
  }

  // Simulate the camera's clamping behaviour (mirrors the pan-to-focus
  // effect in Canvas.tsx). The camera only moves when the focused node
  // would be outside the visible area; otherwise it stays put.
  let newCameraY = cameraY
  if (viewportHeight > 0) {
    const nodeScreenY = focusedNodeY + newCameraY
    if (nodeScreenY < CANVAS_MARGIN) {
      newCameraY = -focusedNodeY + CANVAS_MARGIN
    } else if (nodeScreenY + NODE_HEIGHT > viewportHeight - CANVAS_MARGIN) {
      newCameraY = viewportHeight - CANVAS_MARGIN - focusedNodeY - NODE_HEIGHT
    }
  }
  if (newCameraY !== cameraY) {
    set({ cameraY: newCameraY })
  }

  // The visible canvas-Y below the top bar (breadcrumbs).
  // -newCameraY is the canvas-Y at the very top of the screen;
  // adding CANVAS_PAD_Y pushes past the bar overlay.
  const previewYStart = Math.max(0, -newCameraY + CANVAS_PAD_Y)

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]
    const isCurrentCol = i === currentColumnIndex
    const isPreviewCol = i === currentColumnIndex + 1
    const xOffset = i * (NODE_WIDTH + NODE_H_GAP)

    // Sort nodes so hidden ones come last within the column
    const visible = col.nodes.filter((n) => !hiddenNodeIds.has(n.id))
    const hidden = col.nodes.filter((n) => hiddenNodeIds.has(n.id))
    const orderedNodes = [...visible, ...hidden]

    // For the preview column, start at the top of the visible area
    let yStart = 0
    if (isPreviewCol) {
      yStart = Math.max(0, previewYStart)
    }

    // Position nodes in this column
    const positioned = positionColumnNodes(orderedNodes, xOffset, yStart)

    // Tag nodes: dim non-current columns, mark hidden nodes, mark focused node.
    // The cast is necessary because spreading a discriminated union loses the
    // discriminant in TypeScript's inference — we know the shape is preserved.
    for (const node of positioned) {
      allNodes.push({
        ...node,
        data: {
          ...node.data,
          __columnIndex: i,
          __isCurrent: isCurrentCol,
          __isHidden: hiddenNodeIds.has(node.id),
          __isFocused: node.id === focusedNodeId,
        },
      } as AppNode)
    }

    // Add edges
    for (const edge of col.edges) {
      allEdges.push({ ...edge })
    }
  }

  set({ nodes: allNodes, edges: allEdges })
}
