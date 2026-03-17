import { useDroppable } from '@dnd-kit/core'
import { GripHorizontal } from 'lucide-react'
import type { PanelPosition } from '@/store/layout'
import PanelArea from './PanelArea'

interface DropZoneProps {
  position: PanelPosition
  panelIds: string[]
  /** Which panel is being dragged (null if none) */
  activePanelId: string | null
  /** The insertion index to preview (null if not hovering this zone) */
  previewIndex: number | null
}

export default function DropZone({
  position,
  panelIds,
  activePanelId,
  previewIndex,
}: DropZoneProps) {
  const { setNodeRef } = useDroppable({
    id: `drop-${position}`,
    data: { position },
  })

  const isVertical = position === 'left' || position === 'right'

  // Hide the panel being dragged from its source
  const visiblePanels = activePanelId
    ? panelIds.filter((id) => id !== activePanelId)
    : panelIds

  const showGhost = previewIndex !== null && activePanelId
  const totalSlots = visiblePanels.length + (showGhost ? 1 : 0)

  // Build items in order, inserting ghost at previewIndex
  const items: { type: 'panel' | 'ghost'; id: string }[] = []
  let panelIdx = 0
  for (let i = 0; i < totalSlots; i++) {
    if (showGhost && i === previewIndex) {
      items.push({ type: 'ghost', id: '__ghost__' })
    } else {
      if (panelIdx < visiblePanels.length) {
        items.push({ type: 'panel', id: visiblePanels[panelIdx] })
        panelIdx++
      }
    }
  }

  const isEmpty = visiblePanels.length === 0 && !showGhost

  return (
    <div
      ref={setNodeRef}
      className={`h-full w-full flex ${isVertical ? 'flex-col' : 'flex-row'} ${
        isEmpty && activePanelId
          ? 'bg-muted/20 border-2 border-dashed border-border/40 rounded-sm'
          : ''
      }`}
    >
      {items.map((item) =>
        item.type === 'panel' ? (
          <div
            key={item.id}
            className="min-h-0 min-w-0 transition-all duration-200 ease-out"
            style={{ flex: `1 1 ${100 / totalSlots}%` }}
          >
            <PanelArea id={item.id} position={position} />
          </div>
        ) : (
          <div
            key="__ghost__"
            className="min-h-0 min-w-0 transition-all duration-200 ease-out"
            style={{ flex: `1 1 ${100 / totalSlots}%` }}
          >
            <div className="h-full w-full bg-primary/10 border-2 border-dashed border-primary/30 rounded-sm flex flex-col">
              <div className="flex items-center border-b border-primary/20 shrink-0">
                <span className="flex-1 px-3 py-1.5 text-xs text-primary/40 truncate">
                  {activePanelId}
                </span>
                <div className="px-2 py-1.5 text-primary/40">
                  <GripHorizontal className="h-3.5 w-3.5" />
                </div>
              </div>
              <div className="flex-1" />
            </div>
          </div>
        )
      )}
    </div>
  )
}
