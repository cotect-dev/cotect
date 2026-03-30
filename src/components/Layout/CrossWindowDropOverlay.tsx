import { useCallback, useEffect } from 'react'
import { onMessage, broadcast, type ChannelMessage } from '@/services/channel'
import { getWindowId } from '@/services/platform'
import { useLayoutStore, type PanelPosition } from '@/store/layout'

type HoverZone = PanelPosition | null

interface Props {
  zoneRefs: React.RefObject<Record<PanelPosition, HTMLDivElement | null>>
  mode?: 'main' | 'panel'
}

export default function CrossWindowDropOverlay({ zoneRefs, mode = 'main' }: Props) {
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
    if (mode === 'panel') {
      // Two-zone layout: left/right split at 50%
      zone = x < 0.5 ? 'left' : 'right'
    } else {
      // Three-zone layout: left 25%, right 75%, bottom 75%
      if (y > 0.75) zone = 'bottom'
      else if (x < 0.25) zone = 'left'
      else if (x > 0.75) zone = 'right'
    }

    return { zone, isOver: true }
  }, [mode])

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

  // Compute how deep the cursor is inside this window (min distance from any edge).
  // In an overlap scenario, the window where the cursor is deeper is the intended target.
  const computeDepth = useCallback((screenX: number, screenY: number): number => {
    const left = window.screenX
    const top = window.screenY
    const right = left + window.outerWidth
    const bottom = top + window.outerHeight
    return Math.min(screenX - left, right - screenX, screenY - top, bottom - screenY)
  }, [])

  useEffect(() => {
    let currentIncoming: { panelId: string; panelIds: string[]; sourceWindow: string } | null = null
    let currentZone: HoverZone = null
    let isOver = false
    let lastScreenX = 0
    let lastScreenY = 0

    const unsub = onMessage((msg: ChannelMessage) => {
      if (msg.type === 'drag-start' && msg.sourceWindow !== windowId) {
        currentIncoming = { panelId: msg.panelId, panelIds: msg.panelIds, sourceWindow: msg.sourceWindow }
      } else if (msg.type === 'drag-move' && msg.sourceWindow !== windowId && currentIncoming) {
        lastScreenX = msg.screenX
        lastScreenY = msg.screenY
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
          // Only accept if cursor is deep enough inside this window.
          // In overlapping windows, the shallower window skips.
          const depth = computeDepth(lastScreenX, lastScreenY)
          const halfWidth = window.outerWidth / 2
          const halfHeight = window.outerHeight / 2
          const maxDepth = Math.min(halfWidth, halfHeight)
          const depthRatio = maxDepth > 0 ? depth / maxDepth : 0

          if (depthRatio > 0.1) {
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
            store.moveGroup(currentIncoming.panelIds, currentZone, insertIndex, neighborIndex)
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
