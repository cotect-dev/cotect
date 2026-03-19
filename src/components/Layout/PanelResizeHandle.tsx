import { useCallback, useRef } from 'react'

interface PanelResizeHandleProps {
  orientation: 'horizontal' | 'vertical'
  onResizeEnd: (ratio: number) => void
}

export default function PanelResizeHandle({ orientation, onResizeEnd }: PanelResizeHandleProps) {
  const handleRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const el = handleRef.current
      if (!el) return

      const prevEl = el.previousElementSibling as HTMLElement | null
      const nextEl = el.nextElementSibling as HTMLElement | null
      if (!prevEl || !nextEl) return

      const isVert = orientation === 'vertical'
      const startPos = isVert ? e.clientX : e.clientY
      const prevStart = isVert ? prevEl.offsetWidth : prevEl.offsetHeight
      const nextStart = isVert ? nextEl.offsetWidth : nextEl.offsetHeight
      const totalSize = prevStart + nextStart

      prevEl.style.transition = 'none'
      nextEl.style.transition = 'none'
      el.setAttribute('data-resizing', '')

      const handleMouseMove = (e: MouseEvent) => {
        const current = isVert ? e.clientX : e.clientY
        const delta = current - startPos
        const newPrev = Math.max(40, Math.min(prevStart + delta, totalSize - 40))
        const newNext = totalSize - newPrev
        prevEl.style.flexBasis = `${(newPrev / totalSize) * 100}%`
        nextEl.style.flexBasis = `${(newNext / totalSize) * 100}%`
      }

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        el.removeAttribute('data-resizing')

        // Read final size while inline styles are still applied
        const finalPrev = isVert ? prevEl.offsetWidth : prevEl.offsetHeight
        onResizeEnd(finalPrev / totalSize)

        // Clean up inline overrides AFTER React re-renders with new store values
        requestAnimationFrame(() => {
          prevEl.style.transition = ''
          nextEl.style.transition = ''
          prevEl.style.flexBasis = ''
          nextEl.style.flexBasis = ''
        })
      }

      document.body.style.cursor = isVert ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [orientation, onResizeEnd]
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
