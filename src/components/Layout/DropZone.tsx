import { useCallback } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { GripHorizontal } from 'lucide-react'
import { useLayoutStore, type PanelPosition } from '@/store/layout'
import PanelArea from './PanelArea'
import PanelResizeHandle from './PanelResizeHandle'

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
  // Disable when the zone is effectively empty (no panels, or only the dragged panel)
  const effectivelyEmpty = panelIds.length === 0 || (panelIds.length === 1 && panelIds[0] === activePanelId)
  const { setNodeRef } = useDroppable({
    id: `drop-${position}`,
    data: { position },
    disabled: effectivelyEmpty,
  })

  const sizes = useLayoutStore((s) => s.sizes[position])
  const resizePanels = useLayoutStore((s) => s.resizePanels)

  const isVertical = position === 'left' || position === 'right'

  // Hide the panel being dragged from its source, and track its size index
  const draggedIndex = activePanelId ? panelIds.indexOf(activePanelId) : -1
  const visiblePanels: string[] = []
  const visibleSizes: number[] = []
  for (let i = 0; i < panelIds.length; i++) {
    if (panelIds[i] !== activePanelId) {
      visiblePanels.push(panelIds[i])
      visibleSizes.push(sizes[i] ?? 1)
    }
  }

  const showGhost = previewIndex !== null && activePanelId

  // Build items with sizes that match what movePanel will produce after drop.
  // movePanel splits the neighbor's size in half, so the ghost preview should too.
  const previewSizes = [...visibleSizes]
  let ghostSize = 1
  if (showGhost && visiblePanels.length > 0) {
    const neighborIdx = previewIndex! < visiblePanels.length ? previewIndex! : visiblePanels.length - 1
    const half = previewSizes[neighborIdx] / 2
    previewSizes[neighborIdx] = half
    ghostSize = half
  }

  const items: { type: 'panel' | 'ghost'; id: string; size: number; storeIndex: number }[] = []
  let panelIdx = 0
  const totalSlots = visiblePanels.length + (showGhost ? 1 : 0)
  for (let i = 0; i < totalSlots; i++) {
    if (showGhost && i === previewIndex) {
      items.push({ type: 'ghost', id: '__ghost__', size: ghostSize, storeIndex: -1 })
    } else {
      if (panelIdx < visiblePanels.length) {
        const origIdx = panelIds.indexOf(visiblePanels[panelIdx])
        items.push({ type: 'panel', id: visiblePanels[panelIdx], size: previewSizes[panelIdx], storeIndex: origIdx })
        panelIdx++
      }
    }
  }

  const totalSize = items.reduce((a, b) => a + b.size, 0)
  const isEmpty = visiblePanels.length === 0 && !showGhost
  const isDragging = !!activePanelId

  // Build resize handler for a pair of adjacent visible panels (by their store indices)
  const makeResizeHandler = (leftStoreIdx: number, rightStoreIdx: number) => {
    return (ratio: number) => {
      // We need to find the consecutive store indices for resizePanels
      // Since resizePanels expects adjacent indices, use the smaller one
      const idx = Math.min(leftStoreIdx, rightStoreIdx)
      resizePanels(position, idx, ratio)
    }
  }

  return (
    <div
      ref={setNodeRef}
      className={`h-full w-full flex ${isVertical ? 'flex-col' : 'flex-row'}`}
    >
      {items.map((item, i) => {
        const flexPercent = totalSize > 0 ? (item.size / totalSize) * 100 : 100 / totalSlots
        const elements: React.ReactNode[] = []

        // Add resize handle before this item (between two real panels, not during drag)
        if (i > 0 && !isDragging && item.type === 'panel' && items[i - 1].type === 'panel') {
          elements.push(
            <PanelResizeHandle
              key={`resize-${items[i - 1].id}-${item.id}`}
              orientation={isVertical ? 'horizontal' : 'vertical'}
              onResizeEnd={makeResizeHandler(items[i - 1].storeIndex, item.storeIndex)}
            />
          )
        }

        if (item.type === 'panel') {
          elements.push(
            <div
              key={item.id}
              className="min-h-0 min-w-0 "
              style={{ flex: `1 1 ${flexPercent}%` }}
            >
              <PanelArea id={item.id} position={position} />
            </div>
          )
        } else {
          elements.push(
            <div
              key="__ghost__"
              className="min-h-0 min-w-0 "
              style={{ flex: `1 1 ${flexPercent}%` }}
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
        }

        return elements
      })}
    </div>
  )
}
