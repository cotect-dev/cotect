import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isDemoMode } from '@/lib/demoMode'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  BaseEdge,
  Handle,
  Position,
  useReactFlow,
  type Node,
  type Edge,
  type EdgeProps,
  type NodeMouseHandler,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { FileText, FileCode, FlaskConical, Image } from 'lucide-react'
import { useGraphStore, useBrowserStore, useCanvasStore } from '@/store'
import { toRepoRelative } from '@/lib/repoPath'
import { getConfigForFile } from '@/services/treesitter-queries'
import { isImageFile } from '@/lib/fileClassification'
import type { GraphFileEdge } from '@/store/graph'
import {
  NODE_WIDTH,
  NODE_HEIGHT,
  FOLDER_PAD,
  FOLDER_LABEL_H,
  ROW_GAP,
  EDGE_COLOR_DEPENDENCY,
  EDGE_COLOR_DEPENDENT,
  nearTargetPath,
  directNeighbors,
  layeredLayout,
  pickHandles,
  buildFolderBackgrounds,
  type EgoNode,
} from './graphLayout'

const proOptions = { hideAttribution: true }

function NearTargetEdge(props: EdgeProps) {
  const turnY = (props.data as { turnY?: number } | undefined)?.turnY
  const path = nearTargetPath(
    props.sourceX,
    props.sourceY,
    props.targetX,
    props.targetY,
    props.sourcePosition,
    props.targetPosition,
    turnY,
  )
  return <BaseEdge path={path} style={props.style} markerEnd={props.markerEnd} />
}

const edgeTypes = { nearTarget: NearTargetEdge }

interface GraphNodeData {
  folder: string
  filename: string
  isSelected: boolean
  isTestFile: boolean
  isParseable: boolean
  isImage: boolean
  isSibling: boolean
  [key: string]: unknown
}

const GraphNodeComponent = memo(({ data }: NodeProps<Node<GraphNodeData>>) => {
  const d = data as GraphNodeData
  const Icon = d.isTestFile ? FlaskConical : d.isImage ? Image : d.isParseable ? FileCode : FileText
  const iconColor = d.isTestFile
    ? 'text-yellow-600'
    : d.isImage
      ? 'text-emerald-400'
      : d.isParseable
        ? 'text-blue-400'
        : 'text-muted-foreground'
  const borderClass = d.isTestFile ? 'border-yellow-700/40 border-dashed' : 'border-border'
  const focusRing = d.isSelected ? 'ring-2 ring-primary/40 border-primary/60' : ''

  return (
    <div
      className={`bg-background border rounded-lg px-3 py-2 w-[180px] max-w-[180px] cursor-pointer hover:border-primary/50 hover:bg-muted/50 ${borderClass} ${focusRing} ${d.isTestFile ? 'opacity-60' : d.isSibling ? 'opacity-45' : ''}`}
    >
      <Handle type="source" position={Position.Top} id="s-top" className="opacity-0" />
      <Handle type="source" position={Position.Right} id="s-right" className="opacity-0" />
      <Handle type="source" position={Position.Bottom} id="s-bottom" className="opacity-0" />
      <Handle type="source" position={Position.Left} id="s-left" className="opacity-0" />
      <Handle type="target" position={Position.Top} id="t-top" className="opacity-0" />
      <Handle type="target" position={Position.Right} id="t-right" className="opacity-0" />
      <Handle type="target" position={Position.Bottom} id="t-bottom" className="opacity-0" />
      <Handle type="target" position={Position.Left} id="t-left" className="opacity-0" />

      <div className="flex items-center gap-2 min-w-0 overflow-hidden">
        <Icon className={`h-4 w-4 shrink-0 ${iconColor}`} />
        <span className="text-sm font-medium text-foreground truncate min-w-0">{d.filename}</span>
      </div>
    </div>
  )
})
GraphNodeComponent.displayName = 'GraphNode'

interface FolderBgData {
  folderLabel: string
  width: number
  height: number
  [key: string]: unknown
}

const FolderBgComponent = memo(({ data }: NodeProps<Node<FolderBgData>>) => {
  const d = data as FolderBgData
  return (
    <div
      style={{
        width: d.width,
        height: d.height,
        borderRadius: 2,
        background: 'rgba(46, 50, 56, 0.6)',
        border: '1px solid rgba(148, 163, 184, 0.15)',
        position: 'relative',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 12,
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--color-muted-foreground)',
          opacity: 0.85,
          whiteSpace: 'nowrap',
          lineHeight: '14px',
        }}
      >
        {d.folderLabel}
      </div>
    </div>
  )
})
FolderBgComponent.displayName = 'FolderBg'

const nodeTypes = { graphNode: GraphNodeComponent, folderBg: FolderBgComponent }

function buildGraphData(
  egoNodes: EgoNode[],
  egoEdges: GraphFileEdge[],
  positions: Map<string, { x: number; y: number }>,
  selectedId: string,
): { nodes: Node[]; edges: Edge[] } {
  const folderBgs = buildFolderBackgrounds(egoNodes, positions)

  const folderBgNodes: Node[] = folderBgs.map((bg) => ({
    ...bg,
    type: 'folderBg',
    data: bg.data satisfies FolderBgData,
    selectable: false,
    draggable: false,
    connectable: false,
    focusable: false,
    zIndex: -1,
  }))

  const rfNodes: Node[] = egoNodes.map((en) => {
    const pos = positions.get(en.node.id) ?? { x: 0, y: 0 }
    return {
      id: en.node.id,
      type: 'graphNode',
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: {
        folder: en.node.folder,
        filename: en.node.label,
        isSelected: en.node.id === selectedId,
        isTestFile: en.node.isTestFile,
        isParseable: getConfigForFile(en.node.id) !== null,
        isImage: isImageFile(en.node.label),
        isSibling: en.relation === 'sibling',
      } satisfies GraphNodeData,
    }
  })

  const centerRowIds = new Set(
    egoNodes.filter((en) => en.depth === 0 && en.relation !== 'self').map((en) => en.node.id),
  )

  const rfEdges: Edge[] = egoEdges.map((e) => {
    const srcPos = positions.get(e.source) ?? { x: 0, y: 0 }
    const tgtPos = positions.get(e.target) ?? { x: 0, y: 0 }

    const otherId = e.source === selectedId ? e.target : e.source
    let handles: { sourceHandle: string; targetHandle: string }
    if (centerRowIds.has(otherId)) {
      const dx = tgtPos.x - srcPos.x
      handles =
        dx > 0
          ? { sourceHandle: 's-right', targetHandle: 't-left' }
          : { sourceHandle: 's-left', targetHandle: 't-right' }
    } else {
      handles = pickHandles(srcPos, tgtPos)
    }

    const stroke = e.source === selectedId ? EDGE_COLOR_DEPENDENCY : EDGE_COLOR_DEPENDENT

    let edgeData: { turnY?: number } | undefined
    const isCrossFolder = !centerRowIds.has(otherId)
    if (isCrossFolder) {
      const otherPos = positions.get(otherId)
      const otherDepth = egoNodes.find((en) => en.node.id === otherId)?.depth ?? 0
      if (otherPos) {
        const edgeTurnY =
          otherDepth < 0
            ? otherPos.y + NODE_HEIGHT / 2 + FOLDER_PAD + ROW_GAP / 2
            : otherPos.y - NODE_HEIGHT / 2 - FOLDER_PAD - FOLDER_LABEL_H - ROW_GAP / 2
        edgeData = { turnY: edgeTurnY }
      }
    }

    return {
      id: `${e.target}->${e.source}`,
      source: e.target,
      target: e.source,
      type: 'nearTarget',
      sourceHandle: handles.targetHandle.replace('t-', 's-'),
      targetHandle: handles.sourceHandle.replace('s-', 't-'),
      data: edgeData,
      zIndex: -2,
      animated: true,
      style: { stroke, strokeWidth: 2, strokeOpacity: 0.45 },
    }
  })

  return { nodes: [...folderBgNodes, ...rfNodes], edges: rfEdges }
}

function useCanvasFocusedFilePath(rootPath: string | null): string | null {
  const focusedNodeId = useCanvasStore((s) => s.focusedNodeId)
  const canvasNodes = useCanvasStore((s) => s.nodes)

  return useMemo(() => {
    if (!focusedNodeId || !rootPath) return null
    const node = canvasNodes.find((n) => n.id === focusedNodeId)
    if (!node) return null
    const absPath = (
      node.type === 'folder' || node.type === 'file' ? node.data.path : node.data.filePath
    ) as string | undefined
    if (!absPath) return null
    return toRepoRelative(absPath, rootPath)
  }, [focusedNodeId, canvasNodes, rootPath])
}

function GraphFlow() {
  const rootPath = useBrowserStore((s) => s.rootPath)
  const scanState = useGraphStore((s) => s.scanState)
  const scannedCount = useGraphStore((s) => s.scannedCount)
  const errorMessage = useGraphStore((s) => s.errorMessage)
  const allNodes = useGraphStore((s) => s.allNodes)
  const allEdges = useGraphStore((s) => s.allEdges)
  const scan = useGraphStore((s) => s.scan)
  const [showTests, setShowTests] = useState(false)
  const [demoSelection, setDemoSelection] = useState<string | null>(null)

  const lastScannedRef = useRef<string | null>(null)

  useEffect(() => {
    // demo: stores are pre-seeded; scanning would hit the missing filesystem
    if (isDemoMode()) return
    if (!rootPath || rootPath === lastScannedRef.current) return
    lastScannedRef.current = rootPath
    void scan(rootPath)
  }, [rootPath, scan])

  const canvasFocusedPath = useCanvasFocusedFilePath(rootPath)

  const selectedNodeId = useMemo(() => {
    if (isDemoMode()) {
      // demo: selection stays local to this view. Following the canvas focus
      // would let the canvas demo's autoplay retarget the graph demo.
      if (demoSelection && allNodes.some((n) => n.id === demoSelection)) return demoSelection
    } else if (canvasFocusedPath && allNodes.some((n) => n.id === canvasFocusedPath)) {
      return canvasFocusedPath
    }
    if (allNodes.length > 0) {
      return allNodes.reduce((best, n) => (n.score > best.score ? n : best), allNodes[0]).id
    }
    return null
  }, [canvasFocusedPath, allNodes, demoSelection])

  const { egoNodes, egoEdges } = useMemo(() => {
    if (!selectedNodeId || allNodes.length === 0)
      return { egoNodes: [] as EgoNode[], egoEdges: [] as GraphFileEdge[] }
    const result = directNeighbors(selectedNodeId, allNodes, allEdges, showTests)
    return { egoNodes: result.nodes, egoEdges: result.edges }
  }, [selectedNodeId, allNodes, allEdges, showTests])

  const layoutMeta = useMemo(
    () => layeredLayout(egoNodes, selectedNodeId ?? ''),
    [egoNodes, selectedNodeId],
  )

  const { nodes, edges } = useMemo(
    () => buildGraphData(egoNodes, egoEdges, layoutMeta.positions, selectedNodeId ?? ''),
    [egoNodes, egoEdges, layoutMeta, selectedNodeId],
  )

  const reactFlow = useReactFlow()

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.stopPropagation()
      const viewport = reactFlow.getViewport()
      void reactFlow.setViewport(
        { x: viewport.x - e.deltaX, y: viewport.y - e.deltaY, zoom: viewport.zoom },
        { duration: 0 },
      )
    },
    [reactFlow],
  )

  const focusFileByPath = useCanvasStore((s) => s.focusFileByPath)
  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.type === 'folderBg') return
      if (isDemoMode()) {
        setDemoSelection(node.id)
        return
      }
      void focusFileByPath(node.id)
    },
    [focusFileByPath],
  )

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
        <div className="absolute inset-0" onWheel={handleWheel}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            colorMode="dark"
            proOptions={proOptions}
            nodesDraggable={true}
            nodesConnectable={false}
            elementsSelectable={false}
            onNodeClick={onNodeClick}
            zoomOnScroll={false}
            zoomOnDoubleClick={false}
            zoomOnPinch={false}
            minZoom={1}
            maxZoom={1}
            fitView
            fitViewOptions={{ padding: 0.25 }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={2}
              color="var(--color-foreground)"
              style={{ opacity: 0.1 }}
            />
          </ReactFlow>
        </div>
      )}

      {showOverlay && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-background/80">
          {scanState === 'scanning'
            ? `Scanning project... ${scannedCount} files`
            : 'No parseable source files found.'}
        </div>
      )}

      {scanState === 'ready' && egoNodes.length > 0 && (
        <div className="absolute bottom-3 left-3 flex items-center gap-2 pointer-events-auto">
          <div className="px-2.5 py-1.5 rounded-lg bg-background/80 backdrop-blur-sm border border-border text-[11px] text-muted-foreground font-mono flex items-center gap-3">
            <span>{egoNodes.length} files</span>
            <span className="flex items-center gap-1">
              <span
                style={{
                  display: 'inline-block',
                  width: 12,
                  height: 2,
                  background: EDGE_COLOR_DEPENDENCY,
                  borderRadius: 1,
                }}
              />
              imports
            </span>
            <span className="flex items-center gap-1">
              <span
                style={{
                  display: 'inline-block',
                  width: 12,
                  height: 2,
                  background: EDGE_COLOR_DEPENDENT,
                  borderRadius: 1,
                }}
              />
              imported by
            </span>
            <button
              onClick={() => setShowTests((v) => !v)}
              className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors"
              style={{ opacity: showTests ? 1 : 0.5 }}
            >
              <FlaskConical style={{ width: 12, height: 12, color: '#ca8a04' }} />
              tests {showTests ? 'on' : 'off'}
            </button>
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
