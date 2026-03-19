import { useCallback, useRef } from 'react'

interface ResizeHandleProps {
  orientation: 'horizontal' | 'vertical'
  targetRef: React.RefObject<HTMLDivElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  /** -1 = shrink target when pointer moves positive, 1 = grow target */
  direction?: 1 | -1
  min: number
  max: number
  onResizeEnd: (ratio: number) => void
}

export default function ResizeHandle({
  orientation,
  targetRef,
  containerRef,
  direction = 1,
  min,
  max,
  onResizeEnd,
}: ResizeHandleProps) {
  const startPos = useRef(0)
  const startSize = useRef(0)
  const handleRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const target = targetRef.current
      const container = containerRef.current
      const handle = handleRef.current
      if (!target || !container) return

      const isVert = orientation === 'vertical'
      startPos.current = isVert ? e.clientX : e.clientY
      startSize.current = isVert ? target.offsetWidth : target.offsetHeight

      target.style.transition = 'none'
      handle?.setAttribute('data-resizing', '')

      const containerSize = isVert ? container.clientWidth : container.clientHeight

      const handleMouseMove = (e: MouseEvent) => {
        const current = isVert ? e.clientX : e.clientY
        const delta = (current - startPos.current) * direction
        const newSize = Math.max(min, Math.min(startSize.current + delta, containerSize * max))
        target.style.flexBasis = `${newSize}px`
      }

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        handle?.removeAttribute('data-resizing')

        // Read final size while inline styles are still applied
        const finalSize = isVert ? target.offsetWidth : target.offsetHeight
        onResizeEnd(finalSize / containerSize)

        // Clean up inline overrides AFTER React re-renders with new store values
        requestAnimationFrame(() => {
          target.style.transition = ''
          target.style.flexBasis = ''
        })
      }

      document.body.style.cursor = isVert ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [orientation, targetRef, containerRef, direction, min, max, onResizeEnd]
  )

  const isVertical = orientation === 'vertical'

  return (
    <div
      ref={handleRef}
      onMouseDown={handleMouseDown}
      className={`group/handle relative flex items-center justify-center pointer-events-auto shrink-0
        ${isVertical
          ? 'w-px cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2'
          : 'h-px cursor-row-resize after:absolute after:inset-x-0 after:top-1/2 after:h-1 after:-translate-y-1/2'
        } bg-foreground/10 hover:bg-primary/40 data-[resizing]:bg-primary/40 transition-colors`}
    >
      <div
        className={`z-10 shrink-0 rounded-lg transition-colors
          bg-background border border-foreground/15 group-hover/handle:border-primary/40 group-data-[resizing]/handle:border-primary/40
          ${isVertical ? 'h-6 w-1.5' : 'w-6 h-1.5'}`}
      />
    </div>
  )
}
