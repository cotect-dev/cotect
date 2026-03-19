import { useCallback, useMemo, useRef, useState } from 'react'
import type { Modifier } from '@dnd-kit/core'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragStartEvent,
  type DragMoveEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { GripHorizontal } from 'lucide-react'
import TopBar from './TopBar'
import DropZone from './DropZone'
import EdgeDropTarget from './EdgeDropTarget'
import ResizeHandle from './ResizeHandle'
import { useLayoutStore, type PanelPosition } from '@/store/layout'

interface DragState {
  panelId: string
  fromPosition: PanelPosition
  overPosition: PanelPosition | null
  insertIndex: number
}

interface ZoneSizes {
  left: number
  right: number
  bottom: number
}

const MIN_SIDE = 120
const MIN_BOTTOM = 80

export default function Layout() {
  const { panels, movePanel } = useLayoutStore()
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [zoneSizes, setZoneSizes] = useState<ZoneSizes>({
    left: 0.2,
    right: 0.2,
    bottom: 0.25,
  })

  // Refs to measure drop zone rects during drag
  const zoneRefs = useRef<Record<PanelPosition, HTMLDivElement | null>>({
    left: null,
    right: null,
    bottom: null,
  })
  const containerRef = useRef<HTMLDivElement | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  // Prefer real drop zones over edge targets when both match
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const collisions = pointerWithin(args)
    const dropZone = collisions.find((c) => String(c.id).startsWith('drop-'))
    return dropZone ? [dropZone] : collisions
  }, [])

  const computeInsertIndex = useCallback(
    (position: PanelPosition, pointerX: number, pointerY: number, panelId: string) => {
      const el = zoneRefs.current[position]
      if (!el) return 0

      const rect = el.getBoundingClientRect()
      const isVertical = position === 'left' || position === 'right'

      // Build visible panels and their sizes (excluding the dragged panel)
      const zonePanels = panels[position]
      const zoneSizes = useLayoutStore.getState().sizes[position]
      const visibleSizes: number[] = []
      for (let i = 0; i < zonePanels.length; i++) {
        if (zonePanels[i] !== panelId) {
          visibleSizes.push(zoneSizes[i] ?? 1)
        }
      }

      if (visibleSizes.length === 0) return 0

      const totalSize = visibleSizes.reduce((a, b) => a + b, 0)
      const relativePos = isVertical
        ? (pointerY - rect.top) / rect.height
        : (pointerX - rect.left) / rect.width

      // Walk cumulative sizes to find the insertion boundary at each panel's midpoint
      let cumulative = 0
      for (let i = 0; i < visibleSizes.length; i++) {
        const midpoint = (cumulative + visibleSizes[i] / 2) / totalSize
        if (relativePos < midpoint) return i
        cumulative += visibleSizes[i]
      }
      return visibleSizes.length
    },
    [panels]
  )

  const isNoOpMove = useCallback(
    (panelId: string, fromPos: PanelPosition, toPos: PanelPosition, insertIdx: number): boolean => {
      if (fromPos !== toPos) return false
      const oldIndex = panels[toPos].indexOf(panelId)
      if (oldIndex === -1) return false
      let adjusted = insertIdx
      if (oldIndex < insertIdx) adjusted--
      return adjusted === oldIndex
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

  const centerOnCursor: Modifier = useMemo(() => {
    return ({ activatorEvent, draggingNodeRect, transform }) => {
      if (!activatorEvent || !draggingNodeRect) return transform
      const event = activatorEvent as PointerEvent
      const offsetX = event.clientX - draggingNodeRect.left
      const offsetY = event.clientY - draggingNodeRect.top
      return {
        ...transform,
        x: transform.x + offsetX - draggingNodeRect.width / 2,
        y: transform.y + offsetY - draggingNodeRect.height / 2,
      }
    }
  }, [])

  const isDragging = !!dragState

  const effectiveCount = (pos: PanelPosition) => {
    let count = panels[pos].length
    if (dragState && panels[pos].includes(dragState.panelId)) count--
    if (dragState && dragState.overPosition === pos) count++
    return count
  }

  const leftZoneRef = useRef<HTMLDivElement | null>(null)
  const rightZoneRef = useRef<HTMLDivElement | null>(null)
  const bottomZoneRef = useRef<HTMLDivElement | null>(null)
  const topRowRef = useRef<HTMLDivElement | null>(null)

  const commitLeftSize = useCallback((ratio: number) => {
    setZoneSizes((prev) => ({ ...prev, left: ratio }))
  }, [])
  const commitRightSize = useCallback((ratio: number) => {
    setZoneSizes((prev) => ({ ...prev, right: ratio }))
  }, [])
  const commitBottomSize = useCallback((ratio: number) => {
    setZoneSizes((prev) => ({ ...prev, bottom: ratio }))
  }, [])

  const leftVisible = effectiveCount('left') > 0
  const rightVisible = effectiveCount('right') > 0
  const bottomVisible = effectiveCount('bottom') > 0

  // Zones that have no real panels (ignoring the dragged one) need edge drop targets
  const leftEmpty = isDragging && panels.left.filter((id) => id !== dragState?.panelId).length === 0
  const rightEmpty = isDragging && panels.right.filter((id) => id !== dragState?.panelId).length === 0
  const bottomEmpty = isDragging && panels.bottom.filter((id) => id !== dragState?.panelId).length === 0

  return (
    <div className="w-screen h-screen flex flex-col">
      <div className="pointer-events-none">
        <TopBar />
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div ref={containerRef} className="relative flex-1 min-h-0 w-full flex flex-col pointer-events-none">
          {/* Invisible edge drop targets for empty zones */}
          {leftEmpty && <EdgeDropTarget position="left" />}
          {rightEmpty && <EdgeDropTarget position="right" />}
          {bottomEmpty && <EdgeDropTarget position="bottom" />}
          {/* Top section: left | canvas | right */}
          <div ref={topRowRef} className="flex-1 min-h-0 flex flex-row">
            {/* Left */}
            <div
              ref={(el) => { zoneRefs.current.left = el; leftZoneRef.current = el }}
              className="h-full pointer-events-auto"
              style={{
                flex: leftVisible ? `0 0 ${zoneSizes.left * 100}%` : '0 0 0px',
                minWidth: leftVisible ? MIN_SIDE : 0,
                maxWidth: '40%',
              }}
            >
              <DropZone
                position="left"
                panelIds={panels.left}
                activePanelId={dragState?.panelId ?? null}
                previewIndex={
                  dragState?.overPosition === 'left' &&
                  !isNoOpMove(dragState.panelId, dragState.fromPosition, 'left', dragState.insertIndex)
                    ? dragState.insertIndex
                    : null
                }
              />
            </div>

            {/* Left resize handle */}
            {leftVisible && !isDragging && (
              <ResizeHandle orientation="vertical" targetRef={leftZoneRef} containerRef={topRowRef} min={MIN_SIDE} max={0.4} onResizeEnd={commitLeftSize} />
            )}

            {/* Center spacer */}
            <div className="flex-1 min-w-[20%]" />

            {/* Right resize handle */}
            {rightVisible && !isDragging && (
              <ResizeHandle orientation="vertical" targetRef={rightZoneRef} containerRef={topRowRef} direction={-1} min={MIN_SIDE} max={0.4} onResizeEnd={commitRightSize} />
            )}

            {/* Right */}
            <div
              ref={(el) => { zoneRefs.current.right = el; rightZoneRef.current = el }}
              className="h-full pointer-events-auto"
              style={{
                flex: rightVisible ? `0 0 ${zoneSizes.right * 100}%` : '0 0 0px',
                minWidth: rightVisible ? MIN_SIDE : 0,
                maxWidth: '40%',
              }}
            >
              <DropZone
                position="right"
                panelIds={panels.right}
                activePanelId={dragState?.panelId ?? null}
                previewIndex={
                  dragState?.overPosition === 'right' &&
                  !isNoOpMove(dragState.panelId, dragState.fromPosition, 'right', dragState.insertIndex)
                    ? dragState.insertIndex
                    : null
                }
              />
            </div>
          </div>

          {/* Bottom resize handle */}
          {bottomVisible && !isDragging && (
            <ResizeHandle orientation="horizontal" targetRef={bottomZoneRef} containerRef={containerRef} direction={-1} min={MIN_BOTTOM} max={0.5} onResizeEnd={commitBottomSize} />
          )}

          {/* Bottom */}
          <div
            ref={(el) => { zoneRefs.current.bottom = el; bottomZoneRef.current = el }}
            className="w-full pointer-events-auto"
            style={{
              flex: bottomVisible ? `0 0 ${zoneSizes.bottom * 100}%` : '0 0 0px',
              minHeight: bottomVisible ? MIN_BOTTOM : 0,
              maxHeight: '50%',
            }}
          >
            <DropZone
              position="bottom"
              panelIds={panels.bottom}
              activePanelId={dragState?.panelId ?? null}
              previewIndex={
                dragState?.overPosition === 'bottom' &&
                !isNoOpMove(dragState.panelId, dragState.fromPosition, 'bottom', dragState.insertIndex)
                  ? dragState.insertIndex
                  : null
              }
            />
          </div>
        </div>

        <DragOverlay dropAnimation={null} modifiers={[centerOnCursor]}>
          {dragState ? (
            <div className="pointer-events-none w-[150px] bg-background/90 backdrop-blur-md rounded shadow-lg border border-primary/30 flex items-center">
              <span className="flex-1 px-3 py-1.5 text-xs text-muted-foreground truncate">
                {dragState.panelId}
              </span>
              <div className="px-2 py-1.5 text-muted-foreground">
                <GripHorizontal className="h-3.5 w-3.5" />
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
