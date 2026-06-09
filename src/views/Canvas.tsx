import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  BaseEdge,
  Background,
  BackgroundVariant,
  type EdgeProps,
  type Viewport as RFViewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCanvasStore, useBrowserStore, useViewStore } from '@/store'
import Layout from '@/components/Layout'
import { nodeTypes } from '@/components/Canvas/nodes'
import Breadcrumbs from '@/components/Canvas/Breadcrumbs'
import WindowShell from '@/components/WindowShell'

const Graph = lazy(() => import('@/components/Graph'))
const Settings = lazy(() => import('@/components/Settings'))
const Health = lazy(() => import('@/components/Health'))
import { useCanvasKeyboard } from '@/hooks/useCanvasKeyboard'
import { useCanvasInsets } from '@/hooks/useCanvasInsets'
import { CANVAS_MARGIN } from '@/lib/canvasGeometry'
import { anchorViewport, clampToFocus, type Viewport } from '@/lib/canvasCamera'
import { notifyCanvasScrolled } from '@/components/Canvas/nodes/codeNodeRegistry'
import { defineBinding } from '@/lib/keybindings'

const VIEW_FILES = defineBinding({
  id: 'canvas.view.files',
  label: 'View: Files',
  scope: 'global',
  group: 'Canvas',
  chord: '1',
  matches: (e) => e.key === '1',
})
const VIEW_GRAPH = defineBinding({
  id: 'canvas.view.graph',
  label: 'View: Graph',
  scope: 'global',
  group: 'Canvas',
  chord: '2',
  matches: (e) => e.key === '2',
})
const VIEW_HEALTH = defineBinding({
  id: 'canvas.view.health',
  label: 'View: Health',
  scope: 'global',
  group: 'Canvas',
  chord: '3',
  matches: (e) => e.key === '3',
})
const VIEW_SETTINGS = defineBinding({
  id: 'canvas.view.settings',
  label: 'View: Settings',
  scope: 'global',
  group: 'Canvas',
  chord: '4',
  matches: (e) => e.key === '4',
})
const proOptions = { hideAttribution: true }
const bgStyle = { opacity: 0.1 }

function ColumnEdge({ sourceX, sourceY, targetX, targetY, style }: EdgeProps) {
  if (sourceY === targetY) {
    return <BaseEdge path={`M${sourceX},${sourceY} L${targetX},${targetY}`} style={style} />
  }
  const midX = (sourceX + targetX) / 2
  const path = `M${sourceX},${sourceY} L${midX},${sourceY} L${midX},${targetY} L${targetX},${targetY}`
  return <BaseEdge path={path} style={style} />
}

const edgeTypes = { column: ColumnEdge }

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

  // Seed from DOM — starting at 0 would cause the first panel-resize to shift by −panelW.
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    const el =
      typeof document !== 'undefined'
        ? (document.querySelector('[data-zone="left"]') as HTMLElement | null)
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

  // View switches remount CanvasFlow — skip if already initialized to avoid resetting selection.
  useEffect(() => {
    if (!rootPath) return
    const state = useCanvasStore.getState()
    if (state.columns[0]?.path === rootPath) return
    void state.initRoot(rootPath)
  }, [rootPath])

  const prevPanelWidth = useRef(leftPanelWidth)
  const leftPanelWidthRef = useRef(leftPanelWidth)
  useEffect(() => {
    leftPanelWidthRef.current = leftPanelWidth
  }, [leftPanelWidth])

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

  useEffect(() => {
    return () => {
      const vp = reactFlow.getViewport()
      useCanvasStore.setState({ savedViewport: { x: vp.x, y: vp.y } })
    }
  }, [reactFlow])

  // First run restores a saved viewport from a view switch.
  const isFirstAnchorRef = useRef(true)
  useLayoutEffect(() => {
    const panelW = readPanelW()
    leftPanelWidthRef.current = panelW
    prevPanelWidth.current = panelW

    const isFirst = isFirstAnchorRef.current
    isFirstAnchorRef.current = false

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

  // Re-clamp after panel resize so a growing panel doesn't cover the focused node.
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

  // Skipped on column changes — the anchor effect already clamped.
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

  useEffect(() => {
    containerRef.current?.focus()
  }, [])

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      // Panes marked `.nowheel` (the code editor's `.cm-scroller`, the markdown
      // preview) scroll natively. If we also pan the canvas or re-forward the
      // delta to the editor, the same wheel tick gets applied twice — which
      // desyncs CodeMirror's viewport (lines flicker blank, momentum scrolls
      // stall, clicks land on stale geometry). Let the browser own it.
      if ((e.target as HTMLElement).closest?.('.nowheel')) {
        e.stopPropagation()
        return
      }

      e.stopPropagation()

      const store = useCanvasStore.getState()
      const previewCol = store.columns[store.currentColumnIndex + 1]
      if (previewCol?.kind === 'file' && previewCol.nodes[0]) {
        const focusedId = store.focusedNodeId
        if (!focusedId || store.nodes.find((n) => n.id === focusedId)?.type === 'file') {
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

      const viewport = reactFlow.getViewport()
      void reactFlow.setViewport(
        { x: viewport.x - e.deltaX, y: viewport.y - e.deltaY, zoom: viewport.zoom },
        { duration: 0 },
      )
    },
    [reactFlow],
  )

  const handleViewportChange = useCallback((vp: RFViewport) => {
    notifyCanvasScrolled()
    if (useCanvasStore.getState().cameraY !== vp.y) {
      useCanvasStore.setState({ cameraY: vp.y })
    }
  }, [])

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
        edgeTypes={edgeTypes}
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
          style={bgStyle}
        />
      </ReactFlow>
    </div>
  )
}

function ViewSwitcher() {
  const viewMode = useViewStore((s) => s.viewMode)
  const setViewMode = useViewStore((s) => s.setViewMode)
  const insets = useCanvasInsets()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null
      if (
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.tagName === 'SELECT' ||
          active.isContentEditable ||
          active.closest('.cm-editor'))
      )
        return

      if (VIEW_FILES.matches(e)) {
        e.preventDefault()
        setViewMode('files')
      } else if (VIEW_GRAPH.matches(e)) {
        e.preventDefault()
        setViewMode('graph')
      } else if (VIEW_SETTINGS.matches(e)) {
        e.preventDefault()
        setViewMode('settings')
      } else if (VIEW_HEALTH.matches(e)) {
        e.preventDefault()
        setViewMode('health')
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [setViewMode])

  // Using insets here would drift when side panels have asymmetric widths.
  const contentStyle = {
    top: insets.top,
    left: 0,
    right: 0,
    bottom: 0,
  } as const

  // opacity 0 (not display:none) keeps ReactFlow layout measurements valid.
  const active = (view: typeof viewMode) => viewMode === view
  const insetStyle = (view: typeof viewMode) => ({
    ...contentStyle,
    top: view === 'files' ? 0 : insets.top,
    paddingLeft: view === 'files' ? 0 : insets.left,
    paddingRight: view === 'files' ? 0 : insets.right,
    opacity: active(view) ? 1 : 0,
    zIndex: active(view) ? 0 : -1,
  })

  return (
    <>
      <div className="absolute inset-0" style={insetStyle('files')}>
        <ReactFlowProvider>
          <CanvasFlow />
        </ReactFlowProvider>
      </div>

      <div className="absolute" style={insetStyle('graph')}>
        <Suspense>
          <Graph />
        </Suspense>
      </div>

      <div className="absolute" style={insetStyle('settings')}>
        <Suspense>
          <Settings />
        </Suspense>
      </div>

      <div className="absolute" style={insetStyle('health')}>
        <Suspense>
          <Health />
        </Suspense>
      </div>

      <div className="absolute inset-0 pointer-events-none z-10">
        <Layout />
      </div>

      {/* Rendered outside view wrappers because opacity creates a stacking
       * context that would trap the z-index. */}
      {(viewMode === 'files' || viewMode === 'graph') && <Breadcrumbs />}
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
