import { useCallback, useEffect } from 'react'
import { onMessage, broadcast, type ChannelMessage } from '@/services/channel'
import { getWindowId } from '@/services/platform'
import { useLayoutStore, type PanelPosition } from '@/store/layout'

type HoverZone = PanelPosition | null

interface Props {
  zoneRefs: React.RefObject<Record<PanelPosition, HTMLDivElement | null>>
}

export default function CrossWindowDropOverlay({ zoneRefs }: Props) {
  const windowId = getWindowId()
  const setCrossWindowDrag = useLayoutStore((s) => s.setCrossWindowDrag)

  const detectZoneFromScreen = useCallback((screenX: number, screenY: number): { zone: HoverZone; isOver: boolean } => {
    const winLeft = window.screenX
    const winTop = window.screenY
    const winRight = winLeft + window.outerWidth
    const winBottom = winTop + window.outerHeight

    if (screenX < winLeft || screenX > winRight || screenY < winTop || screenY > winBottom) {
      return { zone: null, isOver: false }
    }

    const x = (screenX - winLeft) / window.outerWidth
    const y = (screenY - winTop) / window.outerHeight

    let zone: HoverZone = null
    if (y > 0.75) zone = 'bottom'
    else if (x < 0.25) zone = 'left'
    else if (x > 0.75) zone = 'right'

    return { zone, isOver: true }
  }, [])

  // Compute insert index within a zone from screen coordinates,
  // using the same logic as usePanelDrag's computeInsertIndex
  const computeInsertFromScreen = useCallback((zone: PanelPosition, screenX: number, screenY: number): { insertIndex: number; neighborIndex: number } => {
    const el = zoneRefs.current[zone]
    if (!el) return { insertIndex: 0, neighborIndex: 0 }

    const rect = el.getBoundingClientRect()
    const isVertical = zone === 'left' || zone === 'right'

    // Convert screen coords to local coords relative to the zone element
    const localX = screenX - window.screenX - (window.outerWidth - window.innerWidth)
    const localY = screenY - window.screenY - (window.outerHeight - window.innerHeight)

    const sizes = useLayoutStore.getState().sizes[zone]
    if (sizes.length === 0) return { insertIndex: 0, neighborIndex: 0 }

    const totalSize = sizes.reduce((a, b) => a + b, 0)
    const relativePos = isVertical
      ? (localY - rect.top) / rect.height
      : (localX - rect.left) / rect.width

    let cumulative = 0
    for (let i = 0; i < sizes.length; i++) {
      const panelEnd = (cumulative + sizes[i]) / totalSize
      if (relativePos < panelEnd) {
        const panelMid = (cumulative + sizes[i] / 2) / totalSize
        if (relativePos < panelMid) {
          return { insertIndex: i, neighborIndex: i }
        } else {
          return { insertIndex: i + 1, neighborIndex: i }
        }
      }
      cumulative += sizes[i]
    }
    return { insertIndex: sizes.length, neighborIndex: sizes.length - 1 }
  }, [zoneRefs])

  useEffect(() => {
    let currentIncoming: { panelId: string; panelIds: string[]; sourceWindow: string } | null = null
    let currentZone: HoverZone = null
    let isOver = false

    const unsub = onMessage((msg: ChannelMessage) => {
      if (msg.type === 'drag-start' && msg.sourceWindow !== windowId) {
        currentIncoming = { panelId: msg.panelId, panelIds: msg.panelIds, sourceWindow: msg.sourceWindow }
      } else if (msg.type === 'drag-move' && msg.sourceWindow !== windowId && currentIncoming) {
        const result = detectZoneFromScreen(msg.screenX, msg.screenY)
        currentZone = result.zone
        isOver = result.isOver

        if (currentZone) {
          const { insertIndex, neighborIndex } = computeInsertFromScreen(currentZone, msg.screenX, msg.screenY)
          setCrossWindowDrag({
            panelId: currentIncoming.panelIds[0],
            panelIds: currentIncoming.panelIds,
            position: currentZone,
            insertIndex,
            neighborIndex,
          })
        } else {
          setCrossWindowDrag(null)
        }
      } else if (msg.type === 'drag-end' && msg.sourceWindow !== windowId) {
        if (currentIncoming && isOver && currentZone) {
          // Read the last computed insert position from the store
          const cwd = useLayoutStore.getState().crossWindowDrag
          const insertIndex = cwd?.insertIndex ?? 0
          const neighborIndex = cwd?.neighborIndex ?? 0

          broadcast({
            type: 'drag-drop',
            panelId: currentIncoming.panelId,
            panelIds: currentIncoming.panelIds,
            targetWindow: windowId,
            position: currentZone,
            groupKey: null,
          })

          const store = useLayoutStore.getState()
          for (const id of currentIncoming.panelIds) {
            store.removePanel(id)
          }
          // Use movePanel to insert at the correct position (not addPanel which always appends)
          // First add the panel, then move it to the right spot
          store.addPanel(currentIncoming.panelIds[0], currentZone)
          // movePanel expects the panel to already be in the store
          store.movePanel(currentIncoming.panelIds[0], currentZone, insertIndex, neighborIndex)
          for (let i = 1; i < currentIncoming.panelIds.length; i++) {
            store.addPanel(currentIncoming.panelIds[i], currentZone)
            store.movePanelToTab(currentIncoming.panelIds[i], currentIncoming.panelIds[0])
          }
        }

        currentIncoming = null
        currentZone = null
        isOver = false
        setCrossWindowDrag(null)
      }
    })

    return () => {
      unsub()
      setCrossWindowDrag(null)
    }
  }, [windowId, detectZoneFromScreen, computeInsertFromScreen, setCrossWindowDrag])

  return null
}
