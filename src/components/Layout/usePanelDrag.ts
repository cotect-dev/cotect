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

const TAB_INTO_HEIGHT = 32 // px from the top of each panel area that counts as "header zone"

export interface DragState {
  panelId: string
  panelIds?: string[] // set when dragging a whole group
  isGroup: boolean
  fromPosition: PanelPosition
  overPosition: PanelPosition | null
  insertIndex: number
  neighborIndex: number
  tabIntoGroupKey: string | null // non-null when hovering over a header to merge as tab
}

export function usePanelDrag() {
  const { panels, movePanel, movePanelToTab, moveGroup, moveGroupToTab } = useLayoutStore()
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
    (position: PanelPosition, pointerX: number, pointerY: number, dragPanelId: string, isGroup: boolean): { insertIndex: number; neighborIndex: number } => {
      const el = zoneRefs.current[position]
      if (!el) return { insertIndex: 0, neighborIndex: 0 }

      const rect = el.getBoundingClientRect()
      const isVertical = position === 'left' || position === 'right'

      const zoneGroups = panels[position]
      const zoneSizes = useLayoutStore.getState().sizes[position]

      const visibleSizes: number[] = []
      for (let i = 0; i < zoneGroups.length; i++) {
        const groupContainsDragged = isGroup
          ? zoneGroups[i][0] === dragPanelId
          : zoneGroups[i].includes(dragPanelId)
        if (!groupContainsDragged) {
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

  const detectTabInto = useCallback(
    (position: PanelPosition, pointerX: number, pointerY: number, dragPanelId: string, isGroup: boolean): string | null => {
      const el = zoneRefs.current[position]
      if (!el) return null

      const rect = el.getBoundingClientRect()
      const isVertical = position === 'left' || position === 'right'

      const zoneGroups = useLayoutStore.getState().panels[position]
      const zoneSizes = useLayoutStore.getState().sizes[position]

      // Build visible groups and sizes (excluding dragged)
      const visible: { key: string; size: number }[] = []
      for (let i = 0; i < zoneGroups.length; i++) {
        const group = zoneGroups[i]
        if (isGroup && group[0] === dragPanelId) continue
        if (!isGroup && group.includes(dragPanelId)) {
          if (group.length > 1) {
            visible.push({ key: group[0], size: zoneSizes[i] ?? 1 })
          }
          continue
        }
        visible.push({ key: group[0], size: zoneSizes[i] ?? 1 })
      }

      if (visible.length === 0) return null

      const totalSize = visible.reduce((a, b) => a + b.size, 0)

      // Compute each panel's region from sizes and check if pointer is in its header zone
      let cumulative = 0
      for (const item of visible) {
        const start = cumulative / totalSize
        const end = (cumulative + item.size) / totalSize
        cumulative += item.size

        let inBounds: boolean
        let inHeader: boolean

        if (isVertical) {
          const panelTop = rect.top + start * rect.height
          const panelBottom = rect.top + end * rect.height
          inBounds = pointerX >= rect.left && pointerX <= rect.right && pointerY >= panelTop && pointerY <= panelBottom
          inHeader = pointerY <= panelTop + TAB_INTO_HEIGHT
        } else {
          const panelLeft = rect.left + start * rect.width
          const panelRight = rect.left + end * rect.width
          inBounds = pointerY >= rect.top && pointerY <= rect.bottom && pointerX >= panelLeft && pointerX <= panelRight
          inHeader = pointerY <= rect.top + TAB_INTO_HEIGHT
        }

        if (inBounds && inHeader) {
          return item.key
        }
      }
      return null
    },
    []
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current
    if (data?.panelId && data?.position) {
      setDragState({
        panelId: data.panelId,
        panelIds: data.isGroup ? data.panelIds : undefined,
        isGroup: !!data.isGroup,
        fromPosition: data.position,
        overPosition: null,
        insertIndex: 0,
        neighborIndex: 0,
        tabIntoGroupKey: null,
      })
    }
  }, [])

  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      setDragState((prev) => {
        if (!prev) return prev

        const overPosition = (event.over?.data.current?.position as PanelPosition) ?? null

        if (!overPosition) {
          if (prev.overPosition === null && prev.tabIntoGroupKey === null) return prev
          return { ...prev, overPosition: null, insertIndex: 0, neighborIndex: 0, tabIntoGroupKey: null }
        }

        const initial = event.activatorEvent as PointerEvent
        const pointerX = initial.clientX + event.delta.x
        const pointerY = initial.clientY + event.delta.y

        // Check if hovering over a panel's header zone (tab-into)
        const tabIntoGroupKey = detectTabInto(overPosition, pointerX, pointerY, prev.panelId, prev.isGroup)

        if (tabIntoGroupKey) {
          if (prev.tabIntoGroupKey === tabIntoGroupKey && prev.overPosition === overPosition) return prev
          return { ...prev, overPosition, insertIndex: 0, neighborIndex: 0, tabIntoGroupKey }
        }

        const { insertIndex, neighborIndex } = computeInsertIndex(overPosition, pointerX, pointerY, prev.panelId, prev.isGroup)

        if (prev.overPosition === overPosition && prev.insertIndex === insertIndex && prev.neighborIndex === neighborIndex && prev.tabIntoGroupKey === null) return prev
        return { ...prev, overPosition, insertIndex, neighborIndex, tabIntoGroupKey: null }
      })
    },
    [computeInsertIndex, detectTabInto]
  )

  const handleDragEnd = useCallback(
    (_event: DragEndEvent) => {
      setDragState((prev) => {
        if (!prev?.overPosition) return null

        if (prev.tabIntoGroupKey) {
          if (prev.isGroup && prev.panelIds) {
            moveGroupToTab(prev.panelIds, prev.tabIntoGroupKey)
          } else {
            movePanelToTab(prev.panelId, prev.tabIntoGroupKey)
          }
        } else {
          if (prev.isGroup && prev.panelIds) {
            moveGroup(prev.panelIds, prev.overPosition, prev.insertIndex, prev.neighborIndex)
          } else {
            movePanel(prev.panelId, prev.overPosition, prev.insertIndex, prev.neighborIndex)
          }
        }

        return null
      })
    },
    [movePanel, movePanelToTab, moveGroup, moveGroupToTab]
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
      if (dragState) {
        const draggedGroupIdx = panels[pos].findIndex((g) =>
          dragState.isGroup ? g[0] === dragState.panelId : g.includes(dragState.panelId)
        )
        if (draggedGroupIdx >= 0) {
          if (!dragState.isGroup && panels[pos][draggedGroupIdx].length > 1) {
            // Group stays, no count change from removal
          } else {
            count--
          }
        }
        if (dragState.overPosition === pos && !dragState.tabIntoGroupKey) count++
      }
      return count
    },
    [panels, dragState]
  )

  const isZoneEmpty = useCallback(
    (pos: PanelPosition) => {
      if (!isDragging) return false
      const remaining = panels[pos].filter((g) => {
        if (dragState?.isGroup) return g[0] !== dragState.panelId
        if (g.includes(dragState?.panelId ?? '')) return g.length > 1
        return true
      })
      return remaining.length === 0
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
