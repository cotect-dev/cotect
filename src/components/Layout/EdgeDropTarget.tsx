import { useDroppable } from '@dnd-kit/core'
import type { PanelPosition } from '@/store/layout'

interface EdgeDropTargetProps {
  position: PanelPosition
}

const positionStyles: Record<PanelPosition, string> = {
  left: 'left-0 top-0 w-[20%] h-full',
  right: 'right-0 top-0 w-[20%] h-full',
  bottom: 'left-0 bottom-0 w-full h-[25%]',
}

export default function EdgeDropTarget({ position }: EdgeDropTargetProps) {
  const { setNodeRef } = useDroppable({
    id: `edge-${position}`,
    data: { position },
  })

  return (
    <div
      ref={setNodeRef}
      className={`absolute ${positionStyles[position]} pointer-events-auto`}
    />
  )
}
