import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { CanvasFlow } from '@/views/Canvas'
import Changes from '@/components/Changes'
import History from '@/components/History'
import { useCanvasStore } from '@/store'
import { useReviewStore, WORKING_TIP } from '@/store/review'
import { useGitStore } from '@/store/git'
import { DEMO_SCRIPT_IDS } from '../demoData'
import { DEMO_FILE_PATH } from '../demoCode'

// The code node is a range-diff view (data.review set), so its hunk overlay is
// keyed by the editor's own merge-chunk start lines, not the seeded workingDiff
// hunks. The first chunk of DEMO_HEAD vs DEMO_AGENT is the inserted
// `maxDelayMs?: number` at after-side line 4 (verified via presentableDiff).
const FIRST_HUNK_START = 4

// Touch panning for the regions ReactFlow's own pan refuses: the code node
// carries `nopan` (so mouse drags select text instead of panning), which also
// blocks touch. This handler takes exactly those gestures and pans manually.
// The 8px threshold leaves taps alone, so accept/comment buttons keep working.
function TouchPanThroughCode({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const reactFlow = useReactFlow()

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let lastX = 0
    let lastY = 0
    let active = false
    let moved = false

    const onStart = (e: TouchEvent) => {
      active = e.touches.length === 1 && !!(e.target as HTMLElement).closest?.('.nopan')
      if (!active) return
      moved = false
      lastX = e.touches[0].clientX
      lastY = e.touches[0].clientY
    }
    const onMove = (e: TouchEvent) => {
      if (!active || e.touches.length !== 1) return
      const dx = e.touches[0].clientX - lastX
      const dy = e.touches[0].clientY - lastY
      if (!moved && Math.hypot(dx, dy) < 8) return
      moved = true
      e.preventDefault()
      lastX = e.touches[0].clientX
      lastY = e.touches[0].clientY
      const vp = reactFlow.getViewport()
      void reactFlow.setViewport({ x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom }, { duration: 0 })
    }
    const onEnd = () => {
      active = false
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [reactFlow, containerRef])

  return null
}

// The canvas only reacts to WASD once it has been clicked (the app's global
// reclaim in useCanvasKeyboard is off in demo mode). This listener removes
// that step: a bare W/A/S/D pressed anywhere while the demo is on screen
// focuses the canvas and performs the move, so visitors can navigate straight
// from the prose inviting them to.
function useWasdGrabsFocus(canvasBoxRef: RefObject<HTMLDivElement | null>, onGrab: () => void) {
  useEffect(() => {
    const KEYS = new Set(['w', 'a', 's', 'd'])

    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || !KEYS.has(e.key.toLowerCase())) return
      const container = canvasBoxRef.current?.querySelector<HTMLElement>('[data-canvas-container]')
      if (!container) return
      // Once the canvas owns focus its own keydown handler navigates; and a
      // visitor typing anywhere (e.g. a future signup field) keeps their keys.
      const active = document.activeElement as HTMLElement | null
      if (active && container.contains(active)) return
      if (
        active &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) ||
          active.isContentEditable ||
          active.closest('.cm-editor'))
      ) {
        return
      }
      const rect = canvasBoxRef.current?.getBoundingClientRect()
      if (!rect || rect.bottom <= 0 || rect.top >= window.innerHeight) return

      e.preventDefault()
      onGrab()
      container.focus({ preventScroll: true })
      const store = useCanvasStore.getState()
      switch (e.key.toLowerCase()) {
        case 'w':
          store.moveFocus('up')
          break
        case 's':
          store.moveFocus('down')
          break
        case 'a':
          store.navigateLeft()
          break
        case 'd':
          void store.navigateRight()
          break
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [canvasBoxRef, onGrab])
}

export function CanvasDemo() {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasBoxRef = useRef<HTMLDivElement>(null)
  const cancelled = useRef(false)
  const played = useRef(false)
  const timers = useRef<number[]>([])

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || played.current) return
        played.current = true
        io.disconnect()
        runScript()
      },
      { threshold: 0.4 },
    )
    io.observe(el)
    const pending = timers.current
    return () => {
      io.disconnect()
      pending.forEach(clearTimeout)
    }
  }, [])

  function runScript() {
    // The seed already opens on the root listing with src focused (col 0), so
    // the script just walks focus forward from there: net -> changed file ->
    // accept. The initial hold lets the root register before the first drill.
    const steps: Array<[number, () => void]> = [
      [900, () => useCanvasStore.getState().setFocus(DEMO_SCRIPT_IDS.netFolder)],
      [1700, () => useCanvasStore.getState().setFocus(DEMO_SCRIPT_IDS.changedFile)],
      [
        2700,
        () => {
          const rs = useReviewStore.getState()
          if (!rs.active) {
            // Mirrors ensureReviewSession in useReviewTarget: an implicit
            // working-tree session keyed by HEAD with an empty file list.
            const headSha = useGitStore.getState().log?.[0]?.hash ?? 'working'
            rs.startReview(headSha, 'HEAD', WORKING_TIP, [])
          }
          useReviewStore.getState().acceptHunk(DEMO_FILE_PATH, FIRST_HUNK_START)
        },
      ],
    ]
    for (const [t, fn] of steps) {
      timers.current.push(
        window.setTimeout(() => {
          if (!cancelled.current) fn()
        }, t),
      )
    }
  }

  const cancel = useCallback(() => {
    cancelled.current = true
  }, [])

  useWasdGrabsFocus(canvasBoxRef, cancel)

  return (
    <div ref={boxRef} onPointerDownCapture={cancel} onKeyDownCapture={cancel}>
      <div
        ref={canvasBoxRef}
        className="relative h-[480px] sm:h-[640px] rounded-lg border border-border overflow-hidden bg-background"
      >
        <ReactFlowProvider>
          <CanvasFlow />
          <TouchPanThroughCode containerRef={canvasBoxRef} />
        </ReactFlowProvider>
      </div>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 h-[420px] sm:h-[220px] rounded-lg border border-border overflow-hidden bg-background">
        <DemoPanel label="Changes" className="max-sm:border-b sm:border-r border-border/50">
          <Changes />
        </DemoPanel>
        <DemoPanel label="History" className="">
          <History />
        </DemoPanel>
      </div>
    </div>
  )
}

// The same real panel components the app docks as panel windows, minus the
// drag-and-drop tab system.
function DemoPanel({
  label,
  className,
  children,
}: {
  label: string
  className: string
  children: ReactNode
}) {
  return (
    <div className={`min-h-0 flex flex-col ${className}`}>
      <div className="flex items-center border-b border-border/50 shrink-0 select-none">
        <span className="border-b-2 border-primary/60 px-2.5 py-1.5 text-xs text-foreground">
          {label}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}
