import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ReactFlow, ReactFlowProvider, useReactFlow, Background, BackgroundVariant, type Viewport as RFViewport } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCanvasStore, useBrowserStore } from '@/store'
import Layout from '@/components/Layout'
import { nodeTypes } from '@/components/Canvas/nodes'
import Breadcrumbs from '@/components/Canvas/Breadcrumbs'
import WindowShell from '@/components/WindowShell'
import { useCanvasKeyboard } from '@/hooks/useCanvasKeyboard'
import { CANVAS_MARGIN } from '@/lib/constants'
import { anchorViewport, clampToFocus, type Viewport } from '@/lib/canvasCamera'
import { notifyCanvasScrolled } from '@/components/Canvas/nodes/codeNodeRegistry'

const proOptions = { hideAttribution: true }

// Initial viewport before any effect runs. Matches anchorViewport(0, 0): no
// panel measured yet, column 0 sitting at MARGIN from the canvas left edge.
const defaultViewport: RFViewport = { x: CANVAS_MARGIN, y: CANVAS_MARGIN, zoom: 1 }

function CanvasFlow() {
  const containerRef = useRef<HTMLDivElement>(null)
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const focusedNodeId = useCanvasStore((s) => s.focusedNodeId)
  const reactFlow = useReactFlow()
  const setViewportHeight = useCanvasStore((s) => s.setViewportHeight)
  const onNodesChange = useCanvasStore((s) => s.onNodesChange)
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange)

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
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (rootPath) {
      void useCanvasStore.getState().initRoot(rootPath)
    }
  }, [rootPath])

  // Track previous panel width to compute deltas on resize
  const prevPanelWidth = useRef(leftPanelWidth)
  // Keep a ref so deferred callbacks (e.g. fallback path on first mount)
  // always read the latest panel width.
  const leftPanelWidthRef = useRef(leftPanelWidth)
  useEffect(() => {
    leftPanelWidthRef.current = leftPanelWidth
  }, [leftPanelWidth])

  // Read panel width directly from the DOM. On first mount the ResizeObserver
  // may not have fired yet — getBoundingClientRect inside useLayoutEffect
  // runs after layout commit, so the value is real even before observers fire.
  const readPanelW = useCallback(() => {
    const panelEl = document.querySelector('[data-zone="left"]')
    return panelEl ? panelEl.getBoundingClientRect().width : leftPanelWidthRef.current
  }, [])

  const readContainerSize = useCallback(() => {
    const r = containerRef.current?.getBoundingClientRect()
    return { width: r?.width ?? 0, height: r?.height ?? 0 }
  }, [])

  // Pan to keep focused node in view when focus or its position changes
  const focusedNode = focusedNodeId ? nodes.find((n) => n.id === focusedNodeId) : null
  const focusedNodeX = focusedNode?.position.x ?? 0
  const focusedNodeY = focusedNode?.position.y ?? 0
  const focusedPosition = focusedNode
    ? { x: focusedNode.position.x, y: focusedNode.position.y }
    : null

  // Anchor on column change: place the new current column at panelW + MARGIN,
  // then clamp to keep the focused node in view (no-op when anchor already
  // lands the focus inside the safe zone). Animated for a smooth slide.
  // useLayoutEffect runs synchronously after DOM commit, so getBoundingClientRect
  // returns a real panel width even on first mount — no setTimeout magic number.
  useLayoutEffect(() => {
    const panelW = readPanelW()
    leftPanelWidthRef.current = panelW
    prevPanelWidth.current = panelW
    let target: Viewport = anchorViewport(currentColumnIndex, panelW)
    if (focusedPosition) {
      target = clampToFocus(target, focusedPosition, panelW, readContainerSize())
    }
    void reactFlow.setViewport({ ...target, zoom: 1 }, { duration: 100 })
  }, [currentColumnIndex, depthChainLength]) // eslint-disable-line react-hooks/exhaustive-deps

  // Shift viewport horizontally when the panel resizes, then re-clamp so a
  // panel grow that covers the focused node is auto-corrected.
  useEffect(() => {
    const delta = leftPanelWidth - prevPanelWidth.current
    prevPanelWidth.current = leftPanelWidth
    if (delta === 0) return
    const vp = reactFlow.getViewport()
    let target: Viewport = { x: vp.x + delta, y: vp.y }
    if (focusedPosition) {
      target = clampToFocus(target, focusedPosition, leftPanelWidth, readContainerSize())
    }
    void reactFlow.setViewport({ ...target, zoom: vp.zoom }, { duration: 0 })
  }, [leftPanelWidth]) // eslint-disable-line react-hooks/exhaustive-deps

  // Focus-clamp: when only the focused node changes (no column switch), clamp
  // the current viewport to keep the new focus visible. Skipped on column
  // changes since the anchor effect above already ran and includes the clamp.
  const prevColumnIndexRef = useRef(currentColumnIndex)
  useEffect(() => {
    const columnChanged = prevColumnIndexRef.current !== currentColumnIndex
    prevColumnIndexRef.current = currentColumnIndex
    if (columnChanged) return
    if (!focusedPosition) return
    const vp = reactFlow.getViewport()
    const target = clampToFocus(
      { x: vp.x, y: vp.y },
      focusedPosition,
      readPanelW(),
      readContainerSize(),
    )
    if (target.x !== vp.x || target.y !== vp.y) {
      void reactFlow.setViewport({ ...target, zoom: vp.zoom }, { duration: 0 })
    }
  }, [focusedNodeId, focusedNodeX, focusedNodeY, currentColumnIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  useCanvasKeyboard(containerRef)

  // Auto-focus container on mount so keyboard navigation works immediately
  useEffect(() => {
    containerRef.current?.focus()
  }, [])

  // Wheel handler: translate vertical scroll into viewport pan, or forward
  // to the preview code node's scroller when a file is focused.
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation()

    // When a file node is focused, hijack scrolling to the preview code node
    const store = useCanvasStore.getState()
    const focusedId = store.focusedNodeId
    if (focusedId) {
      const focused = store.nodes.find((n) => n.id === focusedId)
      if (focused?.type === 'file') {
        const previewCol = store.columns[store.currentColumnIndex + 1]
        if (previewCol?.kind === 'file' && previewCol.nodes[0]) {
          const previewEl = containerRef.current?.querySelector(
            `[data-id="${CSS.escape(previewCol.nodes[0].id)}"]`,
          )
          const scroller = previewEl?.querySelector('.cm-scroller') as HTMLElement | null
          if (scroller) {
            scroller.scrollTop += e.deltaY
            scroller.scrollLeft += e.deltaX
            return
          }
        }
      }
    }

    const viewport = reactFlow.getViewport()
    void reactFlow.setViewport(
      { x: viewport.x - e.deltaX, y: viewport.y - e.deltaY, zoom: viewport.zoom },
      { duration: 0 },
    )
  }, [reactFlow])

  // Whenever the viewport moves — wheel pan, animated set, anything — keep
  // the store's cameraY in sync so flattenAndRender's preview-column math
  // sees the live camera, not a stale value from the last navigation.
  const handleViewportChange = useCallback((vp: RFViewport) => {
    notifyCanvasScrolled()
    if (useCanvasStore.getState().cameraY !== vp.y) {
      useCanvasStore.setState({ cameraY: vp.y })
    }
  }, [])

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
          defaultViewport={defaultViewport}
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
          onViewportChange={handleViewportChange}
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
