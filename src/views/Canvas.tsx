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
import Analytics from '@/views/Analytics'
import { useCanvasKeyboard } from '@/hooks/useCanvasKeyboard'
import { useCanvasInsets } from '@/hooks/useCanvasInsets'
import { CANVAS_MARGIN } from '@/lib/constants'
import { anchorViewport, clampToFocus, type Viewport } from '@/lib/canvasCamera'
import { notifyCanvasScrolled } from '@/components/Canvas/nodes/codeNodeRegistry'
import { defineBinding } from '@/lib/keybindings'

// View-mode chords match the original `e.key === '1'/'2'/'3'` checks, which
// fire regardless of modifier state. A custom matcher preserves that exactly
// (the stricter `matchChord` helper would require no modifiers held).
const VIEW_FILES = defineBinding({
  id: 'canvas.view.files', label: 'View: Files', scope: 'global', group: 'Canvas',
  chord: '1', matches: (e) => e.key === '1',
})
const VIEW_GRAPH = defineBinding({
  id: 'canvas.view.graph', label: 'View: Graph', scope: 'global', group: 'Canvas',
  chord: '2', matches: (e) => e.key === '2',
})
const VIEW_SETTINGS = defineBinding({
  id: 'canvas.view.settings', label: 'View: Settings', scope: 'global', group: 'Canvas',
  chord: '3', matches: (e) => e.key === '3',
})
const VIEW_ANALYTICS = defineBinding({
  id: 'canvas.view.analytics', label: 'View: Analytics', scope: 'global', group: 'Canvas',
  chord: '4', matches: (e) => e.key === '4',
})

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

  // initRoot resets columns / currentColumnIndex / focusedNodeId, so we
  // must NOT re-run it on every CanvasFlow mount — switching views (1↔2↔3)
  // would otherwise drop the user's selection and bounce them back to the
  // root column on return. Skip if the store is already initialized for
  // this rootPath; only re-init when the project actually changes.
  useEffect(() => {
    if (!rootPath) return
    const state = useCanvasStore.getState()
    if (state.columns[0]?.path === rootPath) return
    void state.initRoot(rootPath)
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

  // Save viewport to the store on unmount so view switches preserve position.
  useEffect(() => {
    return () => {
      const vp = reactFlow.getViewport()
      useCanvasStore.setState({ savedViewport: { x: vp.x, y: vp.y } })
    }
  }, [reactFlow])

  // Anchor on column change: place the new current column at panelW + MARGIN,
  // then clamp to keep the focused node in view. Animated for a smooth slide
  // — but the first run restores a saved viewport (from a view switch) when
  // available, or snaps to the computed anchor if this is a fresh session.
  const isFirstAnchorRef = useRef(true)
  useLayoutEffect(() => {
    const panelW = readPanelW()
    leftPanelWidthRef.current = panelW
    prevPanelWidth.current = panelW

    const isFirst = isFirstAnchorRef.current
    isFirstAnchorRef.current = false

    // On remount after a view switch, restore the exact viewport the user had.
    if (isFirst) {
      const saved = useCanvasStore.getState().savedViewport
      if (saved) {
        useCanvasStore.setState({ savedViewport: null })
        void reactFlow.setViewport({ ...saved, zoom: 1 }, { duration: 0 })
        return
      }
    }

    let target: Viewport = anchorViewport(currentColumnIndex, panelW)
    if (focusedPosition) {
      target = clampToFocus(target, focusedPosition, panelW, readContainerSize())
    }
    void reactFlow.setViewport({ ...target, zoom: 1 }, { duration: isFirst ? 0 : 100 })
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

      if (VIEW_FILES.matches(e)) { e.preventDefault(); setViewMode('files') }
      else if (VIEW_GRAPH.matches(e)) { e.preventDefault(); setViewMode('graph') }
      else if (VIEW_SETTINGS.matches(e)) { e.preventDefault(); setViewMode('settings') }
      else if (VIEW_ANALYTICS.matches(e)) { e.preventDefault(); setViewMode('analytics') }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [setViewMode])

  // All three views share the same workspace context (root path, git status,
  // selected file via canvas store, LLM config, etc.) — they're presented as
  // alternative lenses on the same project. TopBar + side panels render
  // unconditionally (panels stay where the user put them across view
  // switches); only the canvas-area content swaps.
  //
  // Positioning: Graph / Settings span the full window minus the TopBar.
  // They sit *under* the panel overlay (same way the files-view canvas
  // does), so panels visually cover the edges but the content is centered
  // on the window itself. Using `insets.left/right` here re-centered within
  // the gap between panels and drifted right whenever the two side panels
  // had different widths (or only one was open).
  const contentStyle = {
    top: insets.top,
    left: 0,
    right: 0,
    bottom: 0,
  } as const

  // Inactive views are kept mounted but hidden so they preserve scroll
  // position, viewport state, and internal component state across switches.
  // `opacity: 0` (not `display: none`) keeps layout measurements valid —
  // ReactFlow needs a sized container. Unlike `visibility: hidden`, children
  // cannot override a parent's opacity, so the view is reliably invisible.
  const active = (view: typeof viewMode) => viewMode === view
  const insetStyle = (view: typeof viewMode) => ({
    ...contentStyle,
    // Files view fills the entire window (behind the z-10 panel overlay);
    // other views start below the TopBar so their content isn't hidden under it.
    top: view === 'files' ? 0 : insets.top,
    paddingLeft: view === 'files' ? 0 : insets.left,
    paddingRight: view === 'files' ? 0 : insets.right,
    // Inactive views: opacity 0 hides them (children can't override), and
    // zIndex -1 pushes them behind everything so no events leak through
    // (children CAN override pointer-events, but can't escape z-order).
    opacity: active(view) ? 1 : 0,
    zIndex: active(view) ? 0 : -1,
  })

  return (
    <>
      {/* Files view — always mounted inside its own ReactFlowProvider */}
      <div className="absolute inset-0" style={insetStyle('files')}>
        <ReactFlowProvider>
          <CanvasFlow />
        </ReactFlowProvider>
      </div>

      <div className="absolute" style={insetStyle('graph')}>
        <Graph />
      </div>

      <div className="absolute" style={insetStyle('settings')}>
        <Settings />
      </div>

      <div className="absolute" style={insetStyle('analytics')}>
        <Analytics />
      </div>

      {/* Panels and TopBar always render, regardless of view — the
        * workspace shell stays consistent so Changes / History /
        * Tasks remain available alongside any view. pointer-events-none on
        * the wrapper lets the underlying view receive interactions
        * everywhere panels and TopBar don't cover. */}
      <div className="absolute inset-0 pointer-events-none z-10">
        <Layout />
      </div>

      {/* Breadcrumbs sit above the Layout overlay (z-20 > z-10) so they're
        * never hidden behind the TopBar. Rendered outside view wrappers
        * because opacity on those creates a stacking context that would
        * trap any child z-index. Visible for files and graph views. */}
      {(viewMode === 'files' || viewMode === 'graph') && (
        <Breadcrumbs />
      )}
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
