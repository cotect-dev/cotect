import { useEffect, useRef, type ReactNode } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
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

export function CanvasDemo() {
  const boxRef = useRef<HTMLDivElement>(null)
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
    const steps: Array<[number, () => void]> = [
      [600, () => useCanvasStore.getState().setFocus(DEMO_SCRIPT_IDS.srcFolder)],
      [1400, () => useCanvasStore.getState().setFocus(DEMO_SCRIPT_IDS.netFolder)],
      [2200, () => useCanvasStore.getState().setFocus(DEMO_SCRIPT_IDS.changedFile)],
      [
        3200,
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

  const cancel = () => {
    cancelled.current = true
  }

  return (
    <div ref={boxRef} onPointerDownCapture={cancel} onKeyDownCapture={cancel}>
      <div className="relative h-[440px] sm:h-[560px] rounded-lg border border-border overflow-hidden bg-background">
        <ReactFlowProvider>
          <CanvasFlow />
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
