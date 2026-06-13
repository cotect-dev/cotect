import { useEffect, useRef, type FC } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import CodeNode from '@/components/Canvas/nodes/CodeNode'
import { useCanvasStore } from '@/store'
import type { CodeNodeData } from '@/types/nodes'
import { DEMO_ROOT } from '../demoData'
import { DEMO_FILE_PATH, DEMO_AGENT, DEMO_HEAD } from '../demoCode'

// The phone counterpart to CanvasDemo. The full canvas is a multi-column,
// WASD-driven, fixed-width editor that does not fit a portrait viewport. This
// drops the canvas and mounts the *real* CodeNode on its own — the same diff /
// hunk-review component the app uses — so "this is not a screenshot" stays
// literally true while fitting a phone.

// Mirrors the code node buildCanvasSeed creates: the agent-changed file shown
// as a range diff against its pre-agent HEAD, which is what surfaces the three
// reviewable hunks (and the smuggled retry-count bump).
const CODE_NODE_DATA: CodeNodeData = {
  label: 'fetchWithRetry.ts',
  filePath: `${DEMO_ROOT}/${DEMO_FILE_PATH}`,
  code: DEMO_AGENT,
  startLine: 1,
  endLine: DEMO_AGENT.split('\n').length,
  headOverride: DEMO_HEAD,
  review: { filePath: DEMO_FILE_PATH },
  // No room for the change minimap on a phone; the diff colors carry it.
  hideMinimap: true,
}

// CodeNode reads `data` only; the rest of NodeProps is unused here.
const CodeNodeView = CodeNode as unknown as FC<{ data: CodeNodeData }>

export function MobileCodeNodeDemo() {
  const ref = useRef<HTMLDivElement>(null)

  // The node takes its width from the shared `codeNodeWidth` store value. Pin it
  // to this container so it fills the phone instead of the desktop default.
  // Guarded on a real width so the (display:none) desktop mount never clobbers
  // the canvas demo's width with 0.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const apply = () => {
      const w = el.clientWidth
      if (w > 0) useCanvasStore.setState({ codeNodeWidth: w })
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    // overflow-hidden clips the node's off-edge resize handle; the rounded clip
    // squares off the node's own left-rounded corners into a full card.
    // `mobile-codenode` (see landing.css) drops the editor's viewport height
    // cap so it renders at full content height and never traps page scroll.
    <div ref={ref} className="mobile-codenode overflow-hidden rounded-lg bg-background">
      <ReactFlowProvider>
        <CodeNodeView data={CODE_NODE_DATA} />
      </ReactFlowProvider>
    </div>
  )
}
