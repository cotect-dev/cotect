import { useDroppable } from '@dnd-kit/core'
import type { PanelPosition } from '@/store/layout'

interface EdgeDropTargetProps {
  position: PanelPosition
  panelMode?: boolean
}

// Percentages mirror the thresholds in `src/lib/panelDropMath.ts`.
// Tailwind can't read JS constants at build time — keep these in sync.
const positionStyles: Record<PanelPosition, string> = {
  left: 'left-0 top-0 w-[20%] h-full',
  right: 'right-0 top-0 w-[20%] h-full',
  bottom: 'left-0 bottom-0 w-full h-[25%]',
}

const panelPositionStyles: Record<PanelPosition, string> = {
  left: 'left-0 top-0 w-1/2 h-full',
  right: 'right-0 top-0 w-1/2 h-full',
  bottom: '',
}

export default function EdgeDropTarget({ position, panelMode }: EdgeDropTargetProps) {
  const { setNodeRef } = useDroppable({
    id: `edge-${position}`,
    data: { position },
  })

  const styles = panelMode ? panelPositionStyles[position] : positionStyles[position]

  return <div ref={setNodeRef} className={`absolute ${styles} pointer-events-auto`} />
}
