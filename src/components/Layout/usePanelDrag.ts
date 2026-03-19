import { useCallback, useMemo, useRef, useState } from 'react'
import type { Modifier } from '@dnd-kit/core'
import {
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragStartEvent,
  type DragMoveEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useLayoutStore, type PanelPosition } from '@/store/layout'

export interface DragState {
  panelId: string
  fromPosition: PanelPosition
  overPosition: PanelPosition | null
  insertIndex: number
  neighborIndex: number
}

export function usePanelDrag() {
  const { panels, movePanel } = useLayoutStore()
  const [dragState, setDragState] = useState<DragState | null>(null)

  const zoneRefs = useRef<Record<PanelPosition, HTMLDivElement | null>>({
    left: null,
    right: null,
    bottom: null,
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const collisionDetection: CollisionDetection = useCallback((args) => {
    const collisions = pointerWithin(args)
    const dropZone = collisions.find((c) => String(c.id).startsWith('drop-'))
    return dropZone ? [dropZone] : collisions
  }, [])

  const computeInsertIndex = useCallback(
    (position: PanelPosition, pointerX: number, pointerY: number, panelId: string): { insertIndex: number; neighborIndex: number } => {
      const el = zoneRefs.current[position]
      if (!el) return { insertIndex: 0, neighborIndex: 0 }

      const rect = el.getBoundingClientRect()
      const isVertical = position === 'left' || position === 'right'

      const zonePanels = panels[position]
      const zoneSizes = useLayoutStore.getState().sizes[position]
      const visibleSizes: number[] = []
      for (let i = 0; i < zonePanels.length; i++) {
        if (zonePanels[i] !== panelId) {
          visibleSizes.push(zoneSizes[i] ?? 1)
        }
      }

      if (visibleSizes.length === 0) return { insertIndex: 0, neighborIndex: 0 }

      const totalSize = visibleSizes.reduce((a, b) => a + b, 0)
      const relativePos = isVertical
        ? (pointerY - rect.top) / rect.height
        : (pointerX - rect.left) / rect.width

      let cumulative = 0
      for (let i = 0; i < visibleSizes.length; i++) {
        const panelEnd = (cumulative + visibleSizes[i]) / totalSize
        if (relativePos < panelEnd) {
          const panelMid = (cumulative + visibleSizes[i] / 2) / totalSize
          if (relativePos < panelMid) {
            return { insertIndex: i, neighborIndex: i }
          } else {
            return { insertIndex: i + 1, neighborIndex: i }
          }
        }
        cumulative += visibleSizes[i]
      }
      return { insertIndex: visibleSizes.length, neighborIndex: visibleSizes.length - 1 }
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
        neighborIndex: 0,
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
          return { ...prev, overPosition: null, insertIndex: 0, neighborIndex: 0 }
        }

        const initial = event.activatorEvent as PointerEvent
        const pointerX = initial.clientX + event.delta.x
        const pointerY = initial.clientY + event.delta.y

        const { insertIndex, neighborIndex } = computeInsertIndex(overPosition, pointerX, pointerY, prev.panelId)

        if (prev.overPosition === overPosition && prev.insertIndex === insertIndex && prev.neighborIndex === neighborIndex) return prev
        return { ...prev, overPosition, insertIndex, neighborIndex }
      })
    },
    [computeInsertIndex]
  )

  const handleDragEnd = useCallback(
    (_event: DragEndEvent) => {
      setDragState((prev) => {
        if (prev?.overPosition != null) {
          movePanel(prev.panelId, prev.overPosition, prev.insertIndex, prev.neighborIndex)
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

  const effectiveCount = useCallback(
    (pos: PanelPosition) => {
      let count = panels[pos].length
      if (dragState && panels[pos].includes(dragState.panelId)) count--
      if (dragState && dragState.overPosition === pos) count++
      return count
    },
    [panels, dragState]
  )

  const isZoneEmpty = useCallback(
    (pos: PanelPosition) => {
      return isDragging && panels[pos].filter((id) => id !== dragState?.panelId).length === 0
    },
    [isDragging, panels, dragState]
  )

  return {
    panels,
    dragState,
    isDragging,
    zoneRefs,
    sensors,
    collisionDetection,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
    centerOnCursor,
    effectiveCount,
    isZoneEmpty,
  }
}
