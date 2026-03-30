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

          // Remove any existing copies, then insert directly at the correct position
          // (avoiding addPanel+movePanel which causes a double size-split)
          const store = useLayoutStore.getState()
          for (const id of currentIncoming.panelIds) {
            store.removePanel(id)
          }

          useLayoutStore.setState((state) => {
            const panels = {
              left: state.panels.left.map((g) => [...g]),
              right: state.panels.right.map((g) => [...g]),
              bottom: state.panels.bottom.map((g) => [...g]),
            }
            const sizes = {
              left: [...state.sizes.left],
              right: [...state.sizes.right],
              bottom: [...state.sizes.bottom],
            }
            const newGroup = [...currentIncoming!.panelIds]

            if (panels[currentZone!].length === 0) {
              panels[currentZone!].push(newGroup)
              sizes[currentZone!] = [1]
            } else {
              const nIdx = neighborIndex < panels[currentZone!].length ? neighborIndex : panels[currentZone!].length - 1
              const half = sizes[currentZone!][nIdx] / 2
              sizes[currentZone!][nIdx] = half
              panels[currentZone!].splice(insertIndex, 0, newGroup)
              sizes[currentZone!].splice(insertIndex, 0, half)
            }

            return { panels, sizes }
          })
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
