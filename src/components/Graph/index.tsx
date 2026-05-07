import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force'
import { useGraphStore, useBrowserStore, useViewStore, useCanvasStore } from '@/store'
import { computeVisibleNodeIds, DEFAULT_HUB_COUNT, type GraphFileNode, type GraphFileEdge } from '@/store/graph'

const proOptions = { hideAttribution: true }

// ---------------------------------------------------------------------------
// Language → color mapping
// ---------------------------------------------------------------------------

const LANGUAGE_COLORS: Record<string, string> = {
  typescript: '#3b82f6', // blue
  javascript: '#3b82f6',
  python: '#22c55e',     // green
  go: '#f97316',         // orange
  rust: '#ef4444',       // red
}

const LANGUAGE_SHORT: Record<string, string> = {
  typescript: 'TS',
  javascript: 'JS',
  python: 'Py',
  go: 'Go',
  rust: 'Rs',
}

// ---------------------------------------------------------------------------
// Force layout
// ---------------------------------------------------------------------------

interface SimNode extends SimulationNodeDatum {
  id: string
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  source: string | SimNode
  target: string | SimNode
}

function computeLayout(
  nodes: GraphFileNode[],
  edges: GraphFileEdge[],
): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) return new Map()

  const simNodes: SimNode[] = nodes.map((n) => ({ id: n.id }))
  const nodeById = new Map(simNodes.map((n) => [n.id, n]))

  const simLinks: SimLink[] = edges
    .filter((e) => nodeById.has(e.source) && nodeById.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }))

  const sim = forceSimulation<SimNode>(simNodes)
    .force('link', forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(120))
    .force('charge', forceManyBody<SimNode>().strength(-200))
    .force('center', forceCenter(0, 0))
    .force('collide', forceCollide<SimNode>(60))
    .stop()

  // Run ticks synchronously
  const ticks = Math.min(300, Math.max(100, nodes.length * 2))
  for (let i = 0; i < ticks; i++) sim.tick()

  const positions = new Map<string, { x: number; y: number }>()
  for (const n of simNodes) {
    positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 })
  }
  return positions
}

// ---------------------------------------------------------------------------
// Convert graph data → ReactFlow nodes/edges
// ---------------------------------------------------------------------------

function toReactFlowData(
  allNodes: GraphFileNode[],
  allEdges: GraphFileEdge[],
  visibleIds: Set<string>,
  hoveredNodeId: string | null,
): { nodes: Node[]; edges: Edge[] } {
  const visibleNodes = allNodes.filter((n) => visibleIds.has(n.id))
  const visibleEdges = allEdges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))

  const positions = computeLayout(visibleNodes, visibleEdges)

  // Determine top 10% threshold for hub sizing
  const scores = visibleNodes.map((n) => n.score).sort((a, b) => b - a)
  const hubThreshold = scores[Math.max(0, Math.floor(scores.length * 0.1) - 1)] ?? 0

  // Edges connected to hovered node
  const hoveredEdgeIds = new Set<string>()
  const hoveredNeighborIds = new Set<string>()
  if (hoveredNodeId) {
    hoveredNeighborIds.add(hoveredNodeId)
    for (const e of visibleEdges) {
      if (e.source === hoveredNodeId || e.target === hoveredNodeId) {
        hoveredEdgeIds.add(`${e.source}->${e.target}`)
        hoveredNeighborIds.add(e.source)
        hoveredNeighborIds.add(e.target)
      }
    }
  }

  const isHovering = hoveredNodeId !== null

  const rfNodes: Node[] = visibleNodes.map((n) => {
    const pos = positions.get(n.id) ?? { x: 0, y: 0 }
    const color = LANGUAGE_COLORS[n.language] ?? '#888'
    const isHub = n.score >= hubThreshold && hubThreshold > 0
    const dimmed = isHovering && !hoveredNeighborIds.has(n.id)

    return {
      id: n.id,
      position: pos,
      data: {
        label: n.folder ? `${n.label}\n${n.folder}` : n.label,
      },
      style: {
        fontSize: isHub ? 12 : 11,
        padding: '6px 10px',
        border: `2px solid ${color}`,
        borderRadius: 8,
        background: 'var(--color-card)',
        color: 'var(--color-foreground)',
        width: isHub ? 160 : 140,
        opacity: dimmed ? 0.1 : 1,
        transition: 'opacity 150ms ease',
        cursor: 'pointer',
      },
    }
  })

  const rfEdges: Edge[] = visibleEdges.map((e) => {
    const edgeKey = `${e.source}->${e.target}`
    const highlighted = hoveredEdgeIds.has(edgeKey)
    const dimmed = isHovering && !highlighted

    return {
      id: edgeKey,
      source: e.source,
      target: e.target,
      type: 'default',
      style: {
        stroke: 'var(--color-muted-foreground)',
        strokeOpacity: dimmed ? 0.05 : highlighted ? 0.8 : 0.3,
        strokeWidth: highlighted ? 2 : 1,
        transition: 'stroke-opacity 150ms ease, stroke-width 150ms ease',
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
  const showAll = useGraphStore((s) => s.showAll)
  const setShowAll = useGraphStore((s) => s.setShowAll)
  const truncated = useGraphStore((s) => s.truncated)
  const scan = useGraphStore((s) => s.scan)

  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)

  // Track last scanned rootPath so we don't re-scan on view switches
  const lastScannedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!rootPath || rootPath === lastScannedRef.current) return
    lastScannedRef.current = rootPath
    void scan(rootPath)
  }, [rootPath, scan])

  const visibleIds = useMemo(
    () => computeVisibleNodeIds(allNodes, showAll),
    [allNodes, showAll],
  )

  const { nodes, edges } = useMemo(
    () => toReactFlowData(allNodes, allEdges, visibleIds, hoveredNodeId),
    [allNodes, allEdges, visibleIds, hoveredNodeId],
  )

  const onNodeMouseEnter: NodeMouseHandler = useCallback((_event, node) => {
    setHoveredNodeId(node.id)
  }, [])

  const onNodeMouseLeave: NodeMouseHandler = useCallback(() => {
    setHoveredNodeId(null)
  }, [])

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    // Navigate to this file in the files view
    useViewStore.getState().setViewMode('files')
    void useCanvasStore.getState().focusFileByPath(node.id)
  }, [])

  // Language breakdown for stats
  const langStats = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of allNodes) {
      const short = LANGUAGE_SHORT[n.language] ?? n.language
      counts.set(short, (counts.get(short) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([lang, count]) => `${count} ${lang}`)
      .join(' · ')
  }, [allNodes])

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
  const visibleCount = visibleIds.size
  const totalCount = allNodes.length
  const edgeCount = allEdges.length
  const showToggle = totalCount > DEFAULT_HUB_COUNT

  return (
    <div className="absolute inset-0">
      {scanState === 'ready' && allNodes.length > 0 && (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          colorMode="dark"
          proOptions={proOptions}
          nodesDraggable={true}
          nodesConnectable={false}
          elementsSelectable={false}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          onNodeClick={onNodeClick}
          minZoom={0.1}
          maxZoom={2}
          fitView
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

      {/* Stats badge */}
      {scanState === 'ready' && allNodes.length > 0 && (
        <div className="absolute bottom-3 left-3 flex items-center gap-2 pointer-events-auto">
          <div className="px-2.5 py-1.5 rounded-lg bg-background/80 backdrop-blur-sm border border-border text-[11px] text-muted-foreground font-mono">
            {visibleCount} of {totalCount} files · {edgeCount} imports
            {langStats && <span> · {langStats}</span>}
            {truncated && <span className="text-yellow-500"> · truncated at 500</span>}
          </div>

          {showToggle && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="px-2.5 py-1.5 rounded-lg bg-background/80 backdrop-blur-sm border border-border text-[11px] text-muted-foreground font-mono hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              {showAll ? 'Show hubs only' : 'Show all'}
            </button>
          )}
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
