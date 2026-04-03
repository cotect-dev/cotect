import { useCallback, useEffect, useRef, useState } from 'react'
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCanvasStore, useBrowserStore } from '@/store'
import Layout from '@/components/Layout'
import { nodeTypes } from '@/components/Canvas/nodes'
import Breadcrumbs from '@/components/Canvas/Breadcrumbs'
import WindowShell from '@/components/WindowShell'
import { useCanvasKeyboard } from '@/hooks/useCanvasKeyboard'
import { NODE_WIDTH, NODE_HEIGHT, CANVAS_PAD_Y, CANVAS_MARGIN } from '@/lib/constants'

const proOptions = { hideAttribution: true }

// Padding from the edges of the visible area
const CANVAS_PAD_X = 48

function CanvasFlow() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { nodes, edges, onNodesChange, onEdgesChange, focusedNodeId } = useCanvasStore()
  const reactFlow = useReactFlow()
  const setViewportHeight = useCanvasStore((s) => s.setViewportHeight)

  const rootPath = useBrowserStore((s) => s.rootPath)
  const currentColumnIndex = useCanvasStore((s) => s.currentColumnIndex)
  const depthChainLength = useCanvasStore((s) => s.depthChain.length)

  // Observe the actual rendered width of the left panel zone
  const [leftPanelWidth, setLeftPanelWidth] = useState(0)
  useEffect(() => {
    const el = document.querySelector('[data-zone="left"]') as HTMLElement | null
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setLeftPanelWidth(entry.contentRect.width)
      }
    })
    observer.observe(el)
    // Read initial size
    setLeftPanelWidth(el.offsetWidth)
    return () => observer.disconnect()
  }, [])

  // Initialize canvas when root path is set
  useEffect(() => {
    if (rootPath) {
      useCanvasStore.getState().initRoot(rootPath)
    }
  }, [rootPath])

  // Track previous panel width to compute deltas on resize
  const prevPanelWidth = useRef(leftPanelWidth)
  // Keep a ref so the deferred viewport callback always reads the latest value
  const leftPanelWidthRef = useRef(leftPanelWidth)
  leftPanelWidthRef.current = leftPanelWidth

  // Set viewport to top-left on actual navigation (not preview updates)
  useEffect(() => {
    prevPanelWidth.current = leftPanelWidthRef.current
    const timer = setTimeout(() => {
      reactFlow.setViewport(
        { x: CANVAS_PAD_X + leftPanelWidthRef.current, y: CANVAS_PAD_Y, zoom: 1 },
        { duration: 200 },
      )
    }, 30)
    return () => clearTimeout(timer)
  }, [currentColumnIndex, depthChainLength]) // eslint-disable-line react-hooks/exhaustive-deps

  // Shift viewport horizontally when panel resizes (not a full reset)
  useEffect(() => {
    const delta = leftPanelWidth - prevPanelWidth.current
    prevPanelWidth.current = leftPanelWidth
    if (delta === 0) return
    const vp = reactFlow.getViewport()
    reactFlow.setViewport(
      { x: vp.x + delta, y: vp.y, zoom: vp.zoom },
      { duration: 0 },
    )
  }, [leftPanelWidth]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pan to keep focused node in view when focus or its position changes
  const focusedNode = focusedNodeId ? nodes.find((n) => n.id === focusedNodeId) : null
  const focusedNodeX = focusedNode?.position.x ?? 0
  const focusedNodeY = focusedNode?.position.y ?? 0

  useEffect(() => {
    if (!focusedNode) return

    const viewport = reactFlow.getViewport()
    const nodeScreenX = focusedNode.position.x * viewport.zoom + viewport.x
    const nodeScreenY = focusedNode.position.y * viewport.zoom + viewport.y

    const container = containerRef.current
    if (!container) return
    const { width: cw, height: ch } = container.getBoundingClientRect()

    const margin = CANVAS_MARGIN
    let newX = viewport.x
    let newY = viewport.y

    if (nodeScreenX < leftPanelWidth + margin) {
      newX = -(focusedNode.position.x * viewport.zoom) + leftPanelWidth + margin
    } else if (nodeScreenX + NODE_WIDTH * viewport.zoom > cw - margin) {
      newX = cw - margin - (focusedNode.position.x + NODE_WIDTH) * viewport.zoom
    }

    if (nodeScreenY < margin) {
      newY = -(focusedNode.position.y * viewport.zoom) + margin
    } else if (nodeScreenY + NODE_HEIGHT * viewport.zoom > ch - margin) {
      newY = ch - margin - (focusedNode.position.y + NODE_HEIGHT) * viewport.zoom
    }

    if (newX !== viewport.x || newY !== viewport.y) {
      reactFlow.setViewport({ x: newX, y: newY, zoom: viewport.zoom }, { duration: 150 })
    }
  }, [focusedNodeId, focusedNodeX, focusedNodeY]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard navigation
  useCanvasKeyboard(containerRef)

  // Auto-focus container on mount so keyboard navigation works immediately
  useEffect(() => {
    containerRef.current?.focus()
  }, [])

  // Wheel handler: translate vertical scroll into viewport pan
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation()
    const viewport = reactFlow.getViewport()
    reactFlow.setViewport(
      { x: viewport.x - e.deltaX, y: viewport.y - e.deltaY, zoom: viewport.zoom },
      { duration: 0 },
    )
  }, [reactFlow])

  // Report container height to the store so flattenAndRender can
  // compute where the visible area starts for the preview column.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height)
      }
    })
    obs.observe(el)
    setViewportHeight(el.getBoundingClientRect().height)
    return () => obs.disconnect()
  }, [setViewportHeight])

  return (
    <>
      <div
        ref={containerRef}
        className="absolute inset-0 outline-none"
        tabIndex={-1}
        data-canvas-container
        onWheel={handleWheel}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          colorMode="dark"
          proOptions={proOptions}
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          zoomOnPinch={false}
          panOnDrag={false}
          panOnScroll={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          disableKeyboardA11y={true}
          minZoom={1}
          maxZoom={1}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#555555" />
        </ReactFlow>
      </div>
      <Breadcrumbs />
      <div className="absolute inset-0 pointer-events-none z-10">
        <Layout />
      </div>
    </>
  )
}

export default function Canvas() {
  return (
    <WindowShell>
      <ReactFlowProvider>
        <CanvasFlow />
      </ReactFlowProvider>
    </WindowShell>
  )
}
