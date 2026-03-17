import { useCallback, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragMoveEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import TopBar from './TopBar'
import DropZone from './DropZone'
import { useLayoutStore, type PanelPosition } from '@/store/layout'

interface DragState {
  panelId: string
  fromPosition: PanelPosition
  overPosition: PanelPosition | null
  insertIndex: number
}

export default function Layout() {
  const { panels, movePanel } = useLayoutStore()
  const [dragState, setDragState] = useState<DragState | null>(null)

  // Refs to measure drop zone rects during drag
  const zoneRefs = useRef<Record<PanelPosition, HTMLDivElement | null>>({
    left: null,
    right: null,
    bottom: null,
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const computeInsertIndex = useCallback(
    (position: PanelPosition, pointerX: number, pointerY: number, panelId: string) => {
      const el = zoneRefs.current[position]
      if (!el) return 0

      const rect = el.getBoundingClientRect()
      const isVertical = position === 'left' || position === 'right'

      // How many panels are currently visible (excluding the one being dragged)
      const visibleCount = panels[position].filter((id) => id !== panelId).length
      if (visibleCount === 0) return 0

      const relativePos = isVertical
        ? (pointerY - rect.top) / rect.height
        : (pointerX - rect.left) / rect.width

      // Clamp to [0, visibleCount]
      const idx = Math.round(relativePos * visibleCount)
      return Math.max(0, Math.min(visibleCount, idx))
    },
    [panels]
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current
    if (data?.panelId && data?.position) {
      setDragState({
        panelId: data.panelId,
        fromPosition: data.position,
        overPosition: null,
        insertIndex: 0,
      })
    }
  }, [])

  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      setDragState((prev) => {
        if (!prev) return prev

        const overPosition = (event.over?.data.current?.position as PanelPosition) ?? null

        if (!overPosition) {
          if (prev.overPosition === null) return prev
          return { ...prev, overPosition: null, insertIndex: 0 }
        }

        // Compute pointer position from initial event + delta
        const initial = event.activatorEvent as PointerEvent
        const pointerX = initial.clientX + event.delta.x
        const pointerY = initial.clientY + event.delta.y

        const insertIndex = computeInsertIndex(overPosition, pointerX, pointerY, prev.panelId)

        if (prev.overPosition === overPosition && prev.insertIndex === insertIndex) return prev
        return { ...prev, overPosition, insertIndex }
      })
    },
    [computeInsertIndex]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragState((prev) => {
        if (prev?.overPosition != null) {
          movePanel(prev.panelId, prev.overPosition, prev.insertIndex)
        }
        return null
      })
    },
    [movePanel]
  )

  const handleDragCancel = useCallback(() => {
    setDragState(null)
  }, [])

  const isDragging = !!dragState

  const effectiveCount = (pos: PanelPosition) => {
    const count = panels[pos].length
    if (dragState && panels[pos].includes(dragState.panelId)) return count - 1
    return count
  }

  return (
    <div className="w-screen h-screen flex flex-col">
      <div className="pointer-events-none">
        <TopBar />
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex-1 min-h-0 w-full flex flex-col pointer-events-none">
          {/* Top section: left | canvas | right */}
          <div className="flex-1 min-h-0 flex flex-row">
            {/* Left */}
            <div
              ref={(el) => { zoneRefs.current.left = el }}
              className="h-full transition-all duration-300 ease-out pointer-events-auto"
              style={{
                flex: effectiveCount('left') > 0 ? '0 0 20%' : isDragging ? '0 0 48px' : '0 0 0px',
                minWidth: effectiveCount('left') > 0 ? 120 : isDragging ? 48 : 0,
                maxWidth: '40%',
              }}
            >
              <DropZone
                position="left"
                panelIds={panels.left}
                activePanelId={dragState?.panelId ?? null}
                previewIndex={dragState?.overPosition === 'left' ? dragState.insertIndex : null}
              />
            </div>

            {/* Center spacer */}
            <div className="flex-1 min-w-[20%]" />

            {/* Right */}
            <div
              ref={(el) => { zoneRefs.current.right = el }}
              className="h-full transition-all duration-300 ease-out pointer-events-auto"
              style={{
                flex: effectiveCount('right') > 0 ? '0 0 20%' : isDragging ? '0 0 48px' : '0 0 0px',
                minWidth: effectiveCount('right') > 0 ? 120 : isDragging ? 48 : 0,
                maxWidth: '40%',
              }}
            >
              <DropZone
                position="right"
                panelIds={panels.right}
                activePanelId={dragState?.panelId ?? null}
                previewIndex={dragState?.overPosition === 'right' ? dragState.insertIndex : null}
              />
            </div>
          </div>

          {/* Bottom */}
          <div
            ref={(el) => { zoneRefs.current.bottom = el }}
            className="w-full transition-all duration-300 ease-out pointer-events-auto"
            style={{
              flex: effectiveCount('bottom') > 0 ? '0 0 25%' : isDragging ? '0 0 48px' : '0 0 0px',
              minHeight: effectiveCount('bottom') > 0 ? 80 : isDragging ? 48 : 0,
              maxHeight: '50%',
            }}
          >
            <DropZone
              position="bottom"
              panelIds={panels.bottom}
              activePanelId={dragState?.panelId ?? null}
              previewIndex={dragState?.overPosition === 'bottom' ? dragState.insertIndex : null}
            />
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {dragState ? (
            <div className="pointer-events-none bg-background/90 backdrop-blur-md rounded shadow-lg border border-primary/30 px-3 py-1 text-xs text-muted-foreground whitespace-nowrap">
              {dragState.panelId}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
