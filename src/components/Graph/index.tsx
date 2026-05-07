import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useGraphStore, useBrowserStore } from '@/store'
import type { GraphFileNode, GraphFileEdge } from '@/store/graph'

const proOptions = { hideAttribution: true }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NODE_WIDTH = 180
const NODE_HEIGHT = 56
const MAX_DEPTH = 3
const MAX_NODES = 60
const MAX_SIBLINGS = 12

const LANGUAGE_BORDER: Record<string, string> = {
  typescript: '#3b82f6',
  javascript: '#3b82f6',
  python: '#22c55e',
  go: '#f97316',
  rust: '#ef4444',
}

// Edge colors relative to the selected node
// "selected imports this" = dependency = blue
// "this imports selected" = dependent = amber
const EDGE_COLOR_DEPENDENCY = '#60a5fa'
const EDGE_COLOR_DEPENDENT = '#fbbf24'
const EDGE_COLOR_NEUTRAL = 'rgba(148, 163, 184, 0.3)'

// ---------------------------------------------------------------------------
// Custom node: folder path (dimmed) above, filename below
// ---------------------------------------------------------------------------

interface GraphNodeData {
  folder: string
  filename: string
  borderColor: string
  isSelected: boolean
  [key: string]: unknown
}

const handleStyle = { opacity: 0, width: 6, height: 6 } as const

const GraphNodeComponent = memo(({ data }: NodeProps<Node<GraphNodeData>>) => {
  const d = data as GraphNodeData
  return (
    <div
      style={{
        padding: '6px 12px',
        borderRadius: 8,
        border: `2px solid ${d.isSelected ? '#fff' : d.borderColor}`,
        background: d.isSelected ? 'rgba(59,130,246,0.15)' : 'var(--color-card)',
        width: NODE_WIDTH,
        boxSizing: 'border-box',
        cursor: 'pointer',
      }}
    >
      <Handle type="source" position={Position.Top} id="s-top" style={handleStyle} />
      <Handle type="source" position={Position.Right} id="s-right" style={handleStyle} />
      <Handle type="source" position={Position.Bottom} id="s-bottom" style={handleStyle} />
      <Handle type="source" position={Position.Left} id="s-left" style={handleStyle} />
      <Handle type="target" position={Position.Top} id="t-top" style={handleStyle} />
      <Handle type="target" position={Position.Right} id="t-right" style={handleStyle} />
      <Handle type="target" position={Position.Bottom} id="t-bottom" style={handleStyle} />
      <Handle type="target" position={Position.Left} id="t-left" style={handleStyle} />

      {d.folder && (
        <div
          style={{
            fontSize: 10,
            opacity: 0.4,
            color: 'var(--color-muted-foreground)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            lineHeight: '14px',
          }}
        >
          {d.folder}
        </div>
      )}
      <div
        style={{
          fontSize: 12,
          fontWeight: d.isSelected ? 600 : 500,
          color: 'var(--color-foreground)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          lineHeight: '18px',
        }}
      >
        {d.filename}
      </div>
    </div>
  )
})
GraphNodeComponent.displayName = 'GraphNode'

const nodeTypes = { graphNode: GraphNodeComponent }

// ---------------------------------------------------------------------------
// Directional BFS — dependencies go UP (negative depth), dependents go DOWN
// ---------------------------------------------------------------------------

interface EgoNode {
  node: GraphFileNode
  /** Signed depth: negative = dependency (above), 0 = selected, positive = dependent (below) */
  depth: number
}

function directionalBfs(
  startId: string,
  allNodes: GraphFileNode[],
  allEdges: GraphFileEdge[],
): { nodes: EgoNode[]; edges: GraphFileEdge[] } {
  const nodeMap = new Map(allNodes.map((n) => [n.id, n]))
  if (!nodeMap.has(startId)) return { nodes: [], edges: [] }

  // Directed adjacency
  // outgoing: source → [targets]  (files this source imports)
  // incoming: target → [sources]  (files that import this target)
  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, string[]>()
  for (const e of allEdges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, [])
    outgoing.get(e.source)!.push(e.target)
    if (!incoming.has(e.target)) incoming.set(e.target, [])
    incoming.get(e.target)!.push(e.source)
  }

  const visited = new Map<string, number>()
  visited.set(startId, 0)

  // Upward BFS: follow outgoing edges (what selected imports, then what
  // those import, etc.)  Each level gets a more negative depth.
  const upQueue: [string, number][] = [[startId, 0]]
  while (upQueue.length > 0 && visited.size < MAX_NODES) {
    const [current, depth] = upQueue.shift()!
    if (-depth >= MAX_DEPTH) continue
    for (const t of outgoing.get(current) ?? []) {
      if (!visited.has(t) && nodeMap.has(t)) {
        visited.set(t, depth - 1)
        upQueue.push([t, depth - 1])
        if (visited.size >= MAX_NODES) break
      }
    }
  }

  // Downward BFS: follow incoming edges (what imports selected, then what
  // imports those, etc.)  Each level gets a more positive depth.
  const downQueue: [string, number][] = [[startId, 0]]
  while (downQueue.length > 0 && visited.size < MAX_NODES) {
    const [current, depth] = downQueue.shift()!
    if (depth >= MAX_DEPTH) continue
    for (const s of incoming.get(current) ?? []) {
      if (!visited.has(s) && nodeMap.has(s)) {
        visited.set(s, depth + 1)
        downQueue.push([s, depth + 1])
        if (visited.size >= MAX_NODES) break
      }
    }
  }

  // Add same-folder siblings at depth 0 (shown left/right of selected)
  const selectedFolder = nodeMap.get(startId)!.folder
  let siblingCount = 0
  for (const n of allNodes) {
    if (siblingCount >= MAX_SIBLINGS) break
    if (visited.has(n.id)) continue
    if (n.folder === selectedFolder) {
      visited.set(n.id, 0)
      siblingCount++
    }
  }

  const result: EgoNode[] = []
  for (const [id, depth] of visited) {
    result.push({ node: nodeMap.get(id)!, depth })
  }

  const visibleSet = new Set(visited.keys())
  const edges = allEdges.filter((e) => visibleSet.has(e.source) && visibleSet.has(e.target))

  return { nodes: result, edges }
}

// ---------------------------------------------------------------------------
// Layered top-to-bottom layout — guarantees zero overlap
// ---------------------------------------------------------------------------

const ROW_SPACING = 120
const COL_SPACING = NODE_WIDTH + 30

function layeredLayout(
  egoNodes: EgoNode[],
  centerId: string,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  if (egoNodes.length === 0) return positions

  // Group by depth
  const byDepth = new Map<number, EgoNode[]>()
  for (const en of egoNodes) {
    if (!byDepth.has(en.depth)) byDepth.set(en.depth, [])
    byDepth.get(en.depth)!.push(en)
  }

  for (const [depth, row] of byDepth) {
    if (depth === 0) {
      // Selected node at center, same-folder siblings on left and right
      const siblings = row.filter((en) => en.node.id !== centerId)
      siblings.sort((a, b) => a.node.id.localeCompare(b.node.id))

      positions.set(centerId, { x: 0, y: 0 })

      const half = Math.ceil(siblings.length / 2)
      const left = siblings.slice(0, half)
      const right = siblings.slice(half)

      left.forEach((en, i) => {
        positions.set(en.node.id, { x: -(i + 1) * COL_SPACING, y: 0 })
      })
      right.forEach((en, i) => {
        positions.set(en.node.id, { x: (i + 1) * COL_SPACING, y: 0 })
      })
    } else {
      // Other rows: centered horizontally
      row.sort((a, b) => a.node.id.localeCompare(b.node.id))
      const totalWidth = row.length * COL_SPACING
      const startX = -totalWidth / 2 + COL_SPACING / 2

      row.forEach((en, i) => {
        positions.set(en.node.id, {
          x: startX + i * COL_SPACING,
          y: depth * ROW_SPACING,
        })
      })
    }
  }

  return positions
}

// ---------------------------------------------------------------------------
// Pick optimal handle pair for step edges
// ---------------------------------------------------------------------------

function pickHandles(
  srcPos: { x: number; y: number },
  tgtPos: { x: number; y: number },
): { sourceHandle: string; targetHandle: string } {
  const dx = tgtPos.x - srcPos.x
  const dy = tgtPos.y - srcPos.y

  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0
      ? { sourceHandle: 's-right', targetHandle: 't-left' }
      : { sourceHandle: 's-left', targetHandle: 't-right' }
  }
  return dy > 0
    ? { sourceHandle: 's-bottom', targetHandle: 't-top' }
    : { sourceHandle: 's-top', targetHandle: 't-bottom' }
}

// ---------------------------------------------------------------------------
// Build ReactFlow nodes + edges
// ---------------------------------------------------------------------------

function buildGraphData(
  egoNodes: EgoNode[],
  egoEdges: GraphFileEdge[],
  positions: Map<string, { x: number; y: number }>,
  selectedId: string,
): { nodes: Node[]; edges: Edge[] } {
  const rfNodes: Node[] = egoNodes.map((en) => {
    const pos = positions.get(en.node.id) ?? { x: 0, y: 0 }
    const borderColor = LANGUAGE_BORDER[en.node.language] ?? '#888'
    return {
      id: en.node.id,
      type: 'graphNode',
      // Offset by half-size so the node center sits at the computed position
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: {
        folder: en.node.folder,
        filename: en.node.label,
        borderColor,
        isSelected: en.node.id === selectedId,
      } satisfies GraphNodeData,
    }
  })

  const rfEdges: Edge[] = egoEdges.map((e) => {
    const srcPos = positions.get(e.source) ?? { x: 0, y: 0 }
    const tgtPos = positions.get(e.target) ?? { x: 0, y: 0 }
    const handles = pickHandles(srcPos, tgtPos)

    // Edge direction: source is the file with the import statement,
    // target is the file being imported.
    const isDirect = e.source === selectedId || e.target === selectedId
    let stroke = EDGE_COLOR_NEUTRAL
    if (e.source === selectedId) {
      // Selected file imports this → dependency (blue)
      stroke = EDGE_COLOR_DEPENDENCY
    } else if (e.target === selectedId) {
      // This file imports selected → dependent (amber)
      stroke = EDGE_COLOR_DEPENDENT
    }

    return {
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      type: 'step',
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      style: {
        stroke,
        strokeWidth: isDirect ? 2 : 1,
        strokeOpacity: isDirect ? 0.9 : 0.4,
      },
    }
  })

  return { nodes: rfNodes, edges: rfEdges }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function GraphFlow() {
  const rootPath = useBrowserStore((s) => s.rootPath)
  const scanState = useGraphStore((s) => s.scanState)
  const scannedCount = useGraphStore((s) => s.scannedCount)
  const errorMessage = useGraphStore((s) => s.errorMessage)
  const allNodes = useGraphStore((s) => s.allNodes)
  const allEdges = useGraphStore((s) => s.allEdges)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const setSelectedNodeId = useGraphStore((s) => s.setSelectedNodeId)
  const scan = useGraphStore((s) => s.scan)

  const lastScannedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!rootPath || rootPath === lastScannedRef.current) return
    lastScannedRef.current = rootPath
    void scan(rootPath)
  }, [rootPath, scan])

  // Directional BFS subgraph from selected node
  const { egoNodes, egoEdges } = useMemo(() => {
    if (!selectedNodeId || allNodes.length === 0) return { egoNodes: [] as EgoNode[], egoEdges: [] as GraphFileEdge[] }
    const result = directionalBfs(selectedNodeId, allNodes, allEdges)
    return { egoNodes: result.nodes, egoEdges: result.edges }
  }, [selectedNodeId, allNodes, allEdges])

  // Layered top-to-bottom positions
  const positions = useMemo(
    () => layeredLayout(egoNodes, selectedNodeId ?? ''),
    [egoNodes, selectedNodeId],
  )

  // ReactFlow data
  const { nodes, edges } = useMemo(
    () => buildGraphData(egoNodes, egoEdges, positions, selectedNodeId ?? ''),
    [egoNodes, egoEdges, positions, selectedNodeId],
  )

  // Click a node → re-center graph on it
  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    setSelectedNodeId(node.id)
  }, [setSelectedNodeId])

  if (scanState === 'idle' || !rootPath) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No project open
      </div>
    )
  }

  if (scanState === 'error') {
    return (
      <div className="flex items-center justify-center h-full text-sm text-red-400">
        Graph build failed: {errorMessage}
      </div>
    )
  }

  const showOverlay = scanState === 'scanning' || (scanState === 'ready' && allNodes.length === 0)

  return (
    <div className="absolute inset-0">
      {scanState === 'ready' && egoNodes.length > 0 && (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          colorMode="dark"
          proOptions={proOptions}
          nodesDraggable={true}
          nodesConnectable={false}
          elementsSelectable={false}
          onNodeClick={onNodeClick}
          minZoom={0.05}
          maxZoom={2}
          fitView
          fitViewOptions={{ padding: 0.15 }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={2}
            color="var(--color-foreground)"
            style={{ opacity: 0.1 }}
          />
        </ReactFlow>
      )}

      {showOverlay && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-background/80">
          {scanState === 'scanning'
            ? `Scanning project... ${scannedCount} files`
            : 'No parseable source files found.'}
        </div>
      )}

      {/* Stats + legend */}
      {scanState === 'ready' && egoNodes.length > 0 && (
        <div className="absolute bottom-3 left-3 flex items-center gap-2 pointer-events-auto">
          <div className="px-2.5 py-1.5 rounded-lg bg-background/80 backdrop-blur-sm border border-border text-[11px] text-muted-foreground font-mono flex items-center gap-3">
            <span>{egoNodes.length} of {allNodes.length} files</span>
            <span className="flex items-center gap-1">
              <span style={{ display: 'inline-block', width: 12, height: 2, background: EDGE_COLOR_DEPENDENCY, borderRadius: 1 }} />
              imports
            </span>
            <span className="flex items-center gap-1">
              <span style={{ display: 'inline-block', width: 12, height: 2, background: EDGE_COLOR_DEPENDENT, borderRadius: 1 }} />
              imported by
            </span>
          </div>
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
