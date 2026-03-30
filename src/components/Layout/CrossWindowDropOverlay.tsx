import { useCallback, useEffect } from 'react'
import { onMessage, broadcast, type ChannelMessage } from '@/services/channel'
import { getWindowId } from '@/services/platform'
import { useLayoutStore, type PanelPosition } from '@/store/layout'

interface IncomingDrag {
  panelId: string
  panelIds: string[]
  sourceWindow: string
}

type HoverZone = PanelPosition | null

export default function CrossWindowDropOverlay() {
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

  useEffect(() => {
    let currentIncoming: IncomingDrag | null = null
    let currentZone: HoverZone = null
    let isOver = false

    const unsub = onMessage((msg: ChannelMessage) => {
      if (msg.type === 'drag-start' && msg.sourceWindow !== windowId) {
        currentIncoming = { panelId: msg.panelId, panelIds: msg.panelIds, sourceWindow: msg.sourceWindow }
      } else if (msg.type === 'drag-move' && msg.sourceWindow !== windowId && currentIncoming) {
        const result = detectZoneFromScreen(msg.screenX, msg.screenY)
        const prevZone = currentZone
        currentZone = result.zone
        isOver = result.isOver

        if (currentZone !== prevZone) {
          setCrossWindowDrag(currentZone ? {
            panelId: currentIncoming.panelId,
            panelIds: currentIncoming.panelIds,
            position: currentZone,
          } : null)
        }
      } else if (msg.type === 'drag-end' && msg.sourceWindow !== windowId) {
        if (currentIncoming && isOver && currentZone) {
          // Drop: broadcast confirmation and add panels locally
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
          store.addPanel(currentIncoming.panelIds[0], currentZone)
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
  }, [windowId, detectZoneFromScreen, setCrossWindowDrag])

  // No rendering — the ghost preview is handled by DropZone via crossWindowDrag state
  return null
}
