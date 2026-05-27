import { useRef } from 'react'
import { useDragHandle } from '@/hooks/useDragHandle'
import { MIN_SIBLING_PANEL } from '@/lib/layoutDefaults'

interface BaseProps {
  orientation: 'horizontal' | 'vertical'
}

interface TargetModeProps extends BaseProps {
  mode: 'target'
  targetRef: React.RefObject<HTMLDivElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  direction?: 1 | -1
  min: number
  max: number
  onResizeEnd: (ratio: number) => void
}

interface SiblingModeProps extends BaseProps {
  mode: 'sibling'
  onResizeEnd: (pixelLeft: number, pixelRight: number, totalPixelWidth: number) => void
}

type ResizeHandleProps = TargetModeProps | SiblingModeProps

type DragState =
  | {
      kind: 'target'
      target: HTMLElement
      container: HTMLElement
      startSize: number
      direction: 1 | -1
      min: number
      max: number
      onEnd: TargetModeProps['onResizeEnd']
    }
  | {
      kind: 'sibling'
      prevEl: HTMLElement
      nextEl: HTMLElement
      allChildren: HTMLElement[]
      prevStart: number
      totalSize: number
      onEnd: SiblingModeProps['onResizeEnd']
    }

const measure = (el: HTMLElement, vert: boolean) => (vert ? el.offsetWidth : el.offsetHeight)

export default function ResizeHandle(props: ResizeHandleProps) {
  const isVert = props.orientation === 'vertical'
  const dragStateRef = useRef<DragState | null>(null)

  const { handleProps } = useDragHandle({
    cursor: isVert ? 'col-resize' : 'row-resize',
    onStart: () => {
      const handle = handleRef.current
      if (!handle) return false

      if (props.mode === 'target') {
        const target = props.targetRef.current
        const container = props.containerRef.current
        if (!target || !container) return false

        target.style.transition = 'none'
        dragStateRef.current = {
          kind: 'target',
          target,
          container,
          startSize: measure(target, isVert),
          direction: props.direction ?? 1,
          min: props.min,
          max: props.max,
          onEnd: props.onResizeEnd,
        }
      } else {
        const prevEl = handle.previousElementSibling as HTMLElement | null
        const nextEl = handle.nextElementSibling as HTMLElement | null
        if (!handle.parentElement || !prevEl || !nextEl) return false

        const allChildren = Array.from(handle.parentElement.children) as HTMLElement[]
        const childSizes = allChildren.map((c) => measure(c, isVert))
        const prevStart = childSizes[allChildren.indexOf(prevEl)]
        const nextStart = childSizes[allChildren.indexOf(nextEl)]

        // Freeze every flex child at its current size so the resize operates
        // in absolute pixels rather than fighting flex-grow mid-drag.
        for (let i = 0; i < allChildren.length; i++) {
          const c = allChildren[i]
          c.style.transition = 'none'
          c.style.flexGrow = '0'
          c.style.flexShrink = '0'
          c.style.flexBasis = `${childSizes[i]}px`
        }

        dragStateRef.current = {
          kind: 'sibling',
          prevEl,
          nextEl,
          allChildren,
          prevStart,
          totalSize: prevStart + nextStart,
          onEnd: props.onResizeEnd,
        }
      }
    },
    onMove: (_e, { deltaX, deltaY }) => {
      const state = dragStateRef.current
      if (!state) return
      const delta = isVert ? deltaX : deltaY

      if (state.kind === 'target') {
        const containerSize = measure(state.container, isVert)
        const newSize = Math.max(
          state.min,
          Math.min(state.startSize + delta * state.direction, containerSize * state.max),
        )
        state.target.style.flexBasis = `${newSize}px`
      } else {
        const newPrev = Math.max(
          MIN_SIBLING_PANEL,
          Math.min(state.prevStart + delta, state.totalSize - MIN_SIBLING_PANEL),
        )
        state.prevEl.style.flexBasis = `${newPrev}px`
        state.nextEl.style.flexBasis = `${state.totalSize - newPrev}px`
      }
    },
    onEnd: () => {
      const state = dragStateRef.current
      if (!state) return

      if (state.kind === 'target') {
        state.onEnd(measure(state.target, isVert) / measure(state.container, isVert))
        state.target.style.transition = ''
      } else {
        state.onEnd(measure(state.prevEl, isVert), measure(state.nextEl, isVert), state.totalSize)
        for (const c of state.allChildren) c.style.transition = ''
      }

      dragStateRef.current = null
    },
  })

  const handleRef = handleProps.ref as React.RefObject<HTMLDivElement | null>

  return (
    <div
      ref={handleRef}
      onMouseDown={handleProps.onMouseDown}
      className={`group/handle relative flex items-center justify-center pointer-events-auto shrink-0
        ${
          isVert
            ? 'w-px cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2'
            : 'h-px cursor-row-resize after:absolute after:inset-x-0 after:top-1/2 after:h-3 after:-translate-y-1/2'
        } bg-foreground/10 hover:bg-primary/40 data-[resizing]:bg-primary/40 transition-colors`}
    >
      <div
        className={`z-10 shrink-0 rounded-lg transition-colors
          bg-background border border-foreground/15 group-hover/handle:border-primary/40 group-data-[resizing]/handle:border-primary/40
          ${isVert ? 'h-6 w-1.5' : 'w-6 h-1.5'}`}
      />
    </div>
  )
}
