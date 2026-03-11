import { useCallback, useRef } from 'react'
import { useLayoutStore } from '../store'

export default function ResizeHandle() {
  const startX = useRef(0)
  const startWidth = useRef(0)

  const onMouseMove = useCallback((e: MouseEvent) => {
    const delta = startX.current - e.clientX
    useLayoutStore.getState().setRightPanelWidth(startWidth.current + delta)
  }, [])

  const onMouseUp = useCallback(() => {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }, [onMouseMove])

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      startX.current = e.clientX
      startWidth.current = useLayoutStore.getState().rightPanelWidth
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [onMouseMove, onMouseUp],
  )

  return (
    <div
      onMouseDown={onMouseDown}
      className="absolute left-0 top-4 bottom-4 w-1.5 z-50 rounded-lg cursor-col-resize hover:bg-stormy-teal/40 active:bg-stormy-teal/60 transition-colors"
    />
  )
}
