import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ReactFlow, ReactFlowProvider, useReactFlow, Background, BackgroundVariant, type Viewport as RFViewport } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCanvasStore, useBrowserStore, useViewStore } from '@/store'
import Layout from '@/components/Layout'
import { nodeTypes } from '@/components/Canvas/nodes'
import Breadcrumbs from '@/components/Canvas/Breadcrumbs'
import WindowShell from '@/components/WindowShell'
import Graph from '@/components/Graph'
import Settings from '@/components/Settings'
import { useCanvasKeyboard } from '@/hooks/useCanvasKeyboard'
import { useCanvasInsets } from '@/hooks/useCanvasInsets'
import { CANVAS_MARGIN } from '@/lib/constants'
import { anchorViewport, clampToFocus, type Viewport } from '@/lib/canvasCamera'
import { notifyCanvasScrolled } from '@/components/Canvas/nodes/codeNodeRegistry'

const proOptions = { hideAttribution: true }

// Matches anchorViewport(0, 0): column 0 at MARGIN before any effect runs.
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

  // Lazy init from the DOM: when CanvasFlow remounts after a view switch
  // the Layout (and its left panel) is already mounted, so seeding to the
  // real width keeps `prevPanelWidth` in sync from the first paint and the
  // panel-resize effect below stays a no-op until the panel actually changes.
  // (Starting at 0 made the first effect run shift the viewport by −panelW.)
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    const el = typeof document !== 'undefined'
      ? document.querySelector('[data-zone="left"]') as HTMLElement | null
      : null
    return el ? el.getBoundingClientRect().width : 0
  })
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

  const prevPanelWidth = useRef(leftPanelWidth)
  // Ref so deferred callbacks always read the latest panel width.
  const leftPanelWidthRef = useRef(leftPanelWidth)
  useEffect(() => {
    leftPanelWidthRef.current = leftPanelWidth
  }, [leftPanelWidth])

  // Read panel width from the DOM: useLayoutEffect runs after layout commit,
  // so getBoundingClientRect returns a real value even before the
  // ResizeObserver has fired on first mount.
  const readPanelW = useCallback(() => {
    const panelEl = document.querySelector('[data-zone="left"]')
    return panelEl ? panelEl.getBoundingClientRect().width : leftPanelWidthRef.current
  }, [])

  const readContainerSize = useCallback(() => {
    const r = containerRef.current?.getBoundingClientRect()
    return { width: r?.width ?? 0, height: r?.height ?? 0 }
  }, [])

  const focusedNode = focusedNodeId ? nodes.find((n) => n.id === focusedNodeId) : null
  const focusedNodeX = focusedNode?.position.x ?? 0
  const focusedNodeY = focusedNode?.position.y ?? 0
  const focusedPosition = focusedNode
    ? { x: focusedNode.position.x, y: focusedNode.position.y }
    : null

  // Anchor on column change: place the new current column at panelW + MARGIN,
  // then clamp to keep the focused node in view. Animated for a smooth slide
  // — but the first run snaps (duration 0) so a fresh mount doesn't slide in
  // from the const `defaultViewport` (which has no panel-width offset).
  const isFirstAnchorRef = useRef(true)
  useLayoutEffect(() => {
    const panelW = readPanelW()
    leftPanelWidthRef.current = panelW
    prevPanelWidth.current = panelW
    let target: Viewport = anchorViewport(currentColumnIndex, panelW)
    if (focusedPosition) {
      target = clampToFocus(target, focusedPosition, panelW, readContainerSize())
    }
    const duration = isFirstAnchorRef.current ? 0 : 100
    isFirstAnchorRef.current = false
    void reactFlow.setViewport({ ...target, zoom: 1 }, { duration })
  }, [currentColumnIndex, depthChainLength]) // eslint-disable-line react-hooks/exhaustive-deps

  // Shift viewport on panel resize, then re-clamp so a panel grow that
  // covers the focused node is auto-corrected.
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

  // Focus-only change: clamp the viewport to keep the new focus visible.
  // Skipped on column changes (the anchor effect already ran with a clamp).
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

  // Auto-focus container on mount so keyboard navigation works immediately.
  useEffect(() => {
    containerRef.current?.focus()
  }, [])

  // Translate vertical wheel into viewport pan, or forward to the preview
  // code node's scroller when a file is focused.
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation()

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

  // Keep store cameraY in sync with every viewport movement so
  // flattenAndRender's preview-column math sees the live camera.
  const handleViewportChange = useCallback((vp: RFViewport) => {
    notifyCanvasScrolled()
    if (useCanvasStore.getState().cameraY !== vp.y) {
      useCanvasStore.setState({ cameraY: vp.y })
    }
  }, [])

  // Report container height so flattenAndRender knows where the visible
  // area starts for the preview column.
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
    </>
  )
}

function ViewSwitcher() {
  const viewMode = useViewStore((s) => s.viewMode)
  const setViewMode = useViewStore((s) => s.setViewMode)
  const insets = useCanvasInsets()

  // Bound at the document level so 1/2/3 work no matter which view is up
  // (the Canvas-scoped keyboard hook only mounts inside the files view).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null
      if (active && (
        active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.tagName === 'SELECT' ||
        active.isContentEditable ||
        active.closest('.cm-editor')
      )) return

      if (e.key === '1') { e.preventDefault(); setViewMode('files') }
      else if (e.key === '2') { e.preventDefault(); setViewMode('graph') }
      else if (e.key === '3') { e.preventDefault(); setViewMode('settings') }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [setViewMode])

  // Inset style positions Graph / Settings inside the rectangle left by the
  // TopBar + side panels, so neither hides under the navbar (where Settings'
  // header buttons used to disappear) nor under a drawer panel. Files view
  // intentionally stays full-bleed — its camera math accounts for the left
  // panel and nodes are meant to scroll under panels visually.
  const insetStyle = {
    top: insets.top,
    left: insets.left,
    right: insets.right,
    bottom: insets.bottom,
  } as const

  return (
    <>
      {viewMode === 'files' && (
        <ReactFlowProvider>
          <CanvasFlow />
        </ReactFlowProvider>
      )}
      {viewMode === 'graph' && (
        <div className="absolute" style={insetStyle}>
          <Graph />
        </div>
      )}
      {viewMode === 'settings' && (
        <div className="absolute overflow-y-auto" style={insetStyle}>
          <div className="mx-auto max-w-2xl p-4">
            <Settings />
          </div>
        </div>
      )}
      {/* Panels and TopBar always render, regardless of view — only the
        * canvas-area content above swaps. pointer-events-none on the wrapper
        * lets the underlying view receive interactions everywhere panels
        * don't cover. */}
      <div className="absolute inset-0 pointer-events-none z-10">
        <Layout />
      </div>
    </>
  )
}

export default function Canvas() {
  return (
    <WindowShell>
      <ViewSwitcher />
    </WindowShell>
  )
}
