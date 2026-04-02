import { create } from 'zustand'
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from '@xyflow/react'
import { getPlatform } from '@/services/platform'
import { analyzeFile } from '@/services/treesitter'
import { HIDDEN_DIRECTORIES, NODE_WIDTH, NODE_HEIGHT, NODE_H_GAP, NODE_V_GAP } from '@/lib/constants'
import type { AppNode } from '@/types/nodes'

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
  if (/^(jest|vitest|karma|cypress|playwright)[.\-]/.test(lower)) return true
  return false
}

export interface SelectedFunction {
  filePath: string
  name: string
  startLine: number
  endLine: number
  content: string
  fullFileContent: string
}

/**
 * A column represents one level in the navigation hierarchy.
 * Each column has a path and the nodes/edges for that level.
 */
export interface Column {
  path: string
  // 'directory' | 'file' | 'code'
  kind: 'directory' | 'file' | 'code'
  nodes: AppNode[]
  edges: Edge[]
}

export type CanvasState = {
  nodes: Node[]
  edges: Edge[]
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
  onConnect: OnConnect
  setNodes: (nodes: Node[]) => void
  setEdges: (edges: Edge[]) => void

  // Focus management
  focusedNodeId: string | null

  // Three-column navigation state
  // columns[0] = leftmost visible, columns[last] = rightmost visible
  // The "current" column is columns[currentColumnIndex]
  columns: Column[]
  currentColumnIndex: number

  // The full depth chain of paths we've traversed (for breadcrumbs)
  depthChain: string[]

  // Code display state
  selectedFunction: SelectedFunction | null

  // Actions
  setFocus: (nodeId: string | null) => void
  moveFocus: (direction: 'up' | 'down') => void
  navigateRight: () => Promise<void>
  navigateLeft: () => void
  initRoot: (rootPath: string) => Promise<void>
  clearSelectedFunction: () => void
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

  return sorted.map((entry): AppNode =>
    entry.isDirectory
      ? { id: entry.path, type: 'folder', position: { x: 0, y: 0 }, data: { label: entry.name, path: entry.path, isDirectory: true as const } }
      : { id: entry.path, type: 'file', position: { x: 0, y: 0 }, data: { label: entry.name, path: entry.path, isTestFile: isTestFile(entry.name) } }
  )
}

/**
 * Build file-level nodes (functions/classes) for a path.
 * If there are no declarations, returns a single code node with the full file content.
 */
async function buildFileNodes(filePath: string): Promise<{ nodes: AppNode[]; edges: Edge[] }> {
  const platform = getPlatform()
  const content = await platform.fs.readFile(filePath)
  const analysis = await analyzeFile(filePath, content)

  const nodes: AppNode[] = []
  const edges: Edge[] = []

  for (const decl of analysis.declarations) {
    const nodeId = `decl:${filePath}:${decl.name}`
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
      const methodId = `decl:${filePath}:${decl.name}:${method.name}`
      nodes.push({
        id: methodId, type: 'functionNode', position: { x: 0, y: 0 },
        data: { label: method.name, kind: 'function', startLine: method.startLine, endLine: method.endLine, isMethod: true },
      })
      edges.push({ id: `e-${nodeId}-${methodId}`, source: nodeId, target: methodId, type: 'smoothstep' })
    }
  }

  // No declarations found — show the full file content as a single code node
  if (nodes.length === 0) {
    const lines = content.split('\n')
    const fileName = filePath.split('/').pop() || filePath
    nodes.push({
      id: `code:${filePath}:__full__`,
      type: 'codeNode',
      position: { x: 0, y: 0 },
      data: {
        label: fileName,
        filePath,
        code: content,
        startLine: 1,
        endLine: lines.length,
      },
    })
  }

  return { nodes, edges }
}

/**
 * Build a code node for a specific function/class.
 */
async function buildCodeNode(filePath: string, name: string, startLine: number, endLine: number): Promise<{ node: AppNode; selectedFunction: SelectedFunction }> {
  const platform = getPlatform()
  const fullFileContent = await platform.fs.readFile(filePath)
  const lines = fullFileContent.split('\n')
  const content = lines.slice(startLine - 1, endLine).join('\n')

  const node: AppNode = {
    id: `code:${filePath}:${name}`,
    type: 'codeNode',
    position: { x: 0, y: 0 },
    data: {
      label: name,
      filePath,
      code: content,
      startLine,
      endLine,
    },
  }

  return {
    node,
    selectedFunction: { filePath, name, startLine, endLine, content, fullFileContent },
  }
}

/**
 * Position nodes within a column at a given X offset.
 * Folders above files, single vertical column.
 */
function positionColumnNodes(nodes: AppNode[], xOffset: number): AppNode[] {
  let y = 0
  return nodes.map((node) => {
    const positioned = { ...node, position: { x: xOffset, y } }
    y += NODE_HEIGHT + NODE_V_GAP
    return positioned
  })
}

/**
 * Find the nearest node above or below the focused node within the same column X position.
 */
function findVerticalNeighbor(
  allNodes: Node[],
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

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],

  focusedNodeId: null,
  columns: [],
  currentColumnIndex: 0,
  depthChain: [],
  selectedFunction: null,

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

  setFocus: (nodeId) => {
    set({ focusedNodeId: nodeId })
    // Fire-and-forget preview update
    get().updatePreview()
  },

  moveFocus: (direction) => {
    const { nodes, focusedNodeId } = get()
    if (nodes.length === 0) return

    if (!focusedNodeId) {
      if (nodes.length > 0) {
        set({ focusedNodeId: nodes[0].id })
        get().updatePreview()
      }
      return
    }

    const nextId = findVerticalNeighbor(nodes, focusedNodeId, direction)
    if (nextId) {
      set({ focusedNodeId: nextId })
      get().updatePreview()
    }
  },

  /**
   * Initialize the canvas with the project root.
   * Shows project meta on the left, root directory contents in the center.
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
        selectedFunction: null,
      })

      // Flatten and position
      flattenAndRender(get, set)
      // Load preview for the first focused node
      get().updatePreview()
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

    const data = node.data as Record<string, unknown>

    // Check if we already have a preview column loaded for this node
    const previewCol = columns[currentColumnIndex + 1]
    const nodeTargetPath = node.type === 'folder' || node.type === 'file'
      ? data.path as string
      : (node.type === 'functionNode' || node.type === 'classNode')
        ? `${columns[currentColumnIndex]?.path}:${data.label}`
        : null

    if (previewCol && nodeTargetPath && previewCol.path === nodeTargetPath) {
      // Promote the existing preview column — no need to re-fetch
      const newChain = [...depthChain.slice(0, currentColumnIndex + 1), nodeTargetPath]

      // Set selectedFunction if entering a code column
      let selectedFunction = null
      if (previewCol.kind === 'code' && (node.type === 'functionNode' || node.type === 'classNode')) {
        const startLine = data.startLine as number
        const endLine = data.endLine as number
        const name = data.label as string
        const filePath = columns[currentColumnIndex]?.path
        if (filePath) {
          try {
            const fullFileContent = await getPlatform().fs.readFile(filePath)
            const lines = fullFileContent.split('\n')
            const content = lines.slice(startLine - 1, endLine).join('\n')
            selectedFunction = { filePath, name, startLine, endLine, content, fullFileContent }
          } catch { /* ignore */ }
        }
      }

      set({
        currentColumnIndex: currentColumnIndex + 1,
        depthChain: newChain,
        selectedFunction,
        focusedNodeId: previewCol.nodes.length > 0 ? previewCol.nodes[0].id : null,
      })

      flattenAndRender(get, set)
      // Load preview for the new focus
      get().updatePreview()
      return
    }

    // No matching preview — load fresh
    try {
      if (node.type === 'folder') {
        const path = data.path as string
        const dirNodes = await buildDirectoryNodes(path)
        const newColumn: Column = { path, kind: 'directory', nodes: dirNodes, edges: [] }

        const newColumns = [...columns.slice(0, currentColumnIndex + 1), newColumn]
        const newChain = [...depthChain.slice(0, currentColumnIndex + 1), path]

        set({
          columns: newColumns,
          currentColumnIndex: currentColumnIndex + 1,
          depthChain: newChain,
          selectedFunction: null,
          focusedNodeId: dirNodes.length > 0 ? dirNodes[0].id : null,
        })

        flattenAndRender(get, set)
        get().updatePreview()
      } else if (node.type === 'file') {
        const path = data.path as string
        const isImport = data.isImport as boolean | undefined
        if (isImport) return

        const { nodes: fileNodes, edges: fileEdges } = await buildFileNodes(path)

        const newColumn: Column = { path, kind: 'file', nodes: fileNodes, edges: fileEdges }
        const newColumns = [...columns.slice(0, currentColumnIndex + 1), newColumn]
        const newChain = [...depthChain.slice(0, currentColumnIndex + 1), path]

        set({
          columns: newColumns,
          currentColumnIndex: currentColumnIndex + 1,
          depthChain: newChain,
          selectedFunction: null,
          focusedNodeId: fileNodes[0]?.id ?? null,
        })

        flattenAndRender(get, set)
        get().updatePreview()
      } else if (node.type === 'functionNode' || node.type === 'classNode') {
        const startLine = data.startLine as number
        const endLine = data.endLine as number
        const name = data.label as string

        const currentCol = columns[currentColumnIndex]
        if (!currentCol || currentCol.kind !== 'file') return

        const filePath = currentCol.path
        const { node: codeNode, selectedFunction } = await buildCodeNode(filePath, name, startLine, endLine)

        const newColumn: Column = { path: `${filePath}:${name}`, kind: 'code', nodes: [codeNode], edges: [] }
        const newColumns = [...columns.slice(0, currentColumnIndex + 1), newColumn]
        const newChain = [...depthChain.slice(0, currentColumnIndex + 1), `${filePath}:${name}`]

        set({
          columns: newColumns,
          currentColumnIndex: currentColumnIndex + 1,
          depthChain: newChain,
          selectedFunction,
          focusedNodeId: codeNode.id,
        })

        flattenAndRender(get, set)
      }
    } catch (err) {
      console.error('Failed to navigate right:', err)
    }
  },

  /**
   * Navigate left (A key) — go back to parent column.
   */
  navigateLeft: () => {
    const { columns, currentColumnIndex } = get()
    if (currentColumnIndex <= 0) return

    const newIndex = currentColumnIndex - 1

    // Try to restore focus to the item in the parent column that led to the current column
    const currentColPath = columns[currentColumnIndex]?.path
    const parentCol = columns[newIndex]
    let restoreFocusId: string | null = null

    if (parentCol && currentColPath) {
      const match = parentCol.nodes.find((n) => {
        const d = n.data as Record<string, unknown>
        return d.path === currentColPath
      })
      if (match) restoreFocusId = match.id
    }

    set({
      currentColumnIndex: newIndex,
      selectedFunction: null,
      focusedNodeId: restoreFocusId || (parentCol?.nodes[0]?.id ?? null),
    })

    flattenAndRender(get, set)
    // Load preview for the restored focus
    get().updatePreview()
  },

  clearSelectedFunction: () => set({ selectedFunction: null }),

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

    const data = node.data as Record<string, unknown>

    try {
      let previewCol: Column | null = null

      if (node.type === 'folder') {
        const path = data.path as string
        const dirNodes = await buildDirectoryNodes(path)
        previewCol = { path, kind: 'directory', nodes: dirNodes, edges: [] }
      } else if (node.type === 'file') {
        const path = data.path as string
        const isImport = data.isImport as boolean | undefined
        if (!isImport) {
          const { nodes: fileNodes, edges: fileEdges } = await buildFileNodes(path)
          previewCol = { path, kind: 'file', nodes: fileNodes, edges: fileEdges }
        }
      } else if (node.type === 'functionNode' || node.type === 'classNode') {
        if (currentCol.kind === 'file') {
          const startLine = data.startLine as number
          const endLine = data.endLine as number
          const name = data.label as string
          const filePath = currentCol.path
          const { node: codeNode } = await buildCodeNode(filePath, name, startLine, endLine)
          previewCol = { path: `${filePath}:${name}`, kind: 'code', nodes: [codeNode], edges: [] }
        }
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
}))

/**
 * Flatten all visible columns into positioned nodes and edges,
 * then update the store's nodes/edges for ReactFlow rendering.
 *
 * Visible columns: up to 3 columns centered on currentColumnIndex.
 * - If current is 0: show columns [0, 1] (if exists)
 * - If current is last: show columns [last-1, last]
 * - Otherwise: show [current-1, current, current+1]
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

  // Determine visible range
  let startIdx = Math.max(0, currentColumnIndex - 1)
  let endIdx = Math.min(columns.length - 1, currentColumnIndex + 1)

  // Ensure we show up to 3 columns if available
  if (endIdx - startIdx < 2 && columns.length > 2) {
    if (startIdx === 0) endIdx = Math.min(columns.length - 1, 2)
    else if (endIdx === columns.length - 1) startIdx = Math.max(0, endIdx - 2)
  }

  const allNodes: Node[] = []
  const allEdges: Edge[] = []
  let xOffset = 0

  for (let i = startIdx; i <= endIdx; i++) {
    const col = columns[i]
    const isCurrentCol = i === currentColumnIndex

    // Position nodes in this column
    const positioned = positionColumnNodes(col.nodes, xOffset)

    // Tag nodes: dim non-current columns
    for (const node of positioned) {
      allNodes.push({
        ...node,
        // Prefix IDs to avoid collisions across columns - but keep original for matching
        id: node.id,
        data: {
          ...node.data,
          __columnIndex: i,
          __isCurrent: isCurrentCol,
        },
      } as Node)
    }

    // Add edges
    for (const edge of col.edges) {
      allEdges.push({ ...edge })
    }

    // Calculate column width: find max node count to determine height, then advance X
    xOffset += NODE_WIDTH + NODE_H_GAP
  }

  set({ nodes: allNodes, edges: allEdges })
}
