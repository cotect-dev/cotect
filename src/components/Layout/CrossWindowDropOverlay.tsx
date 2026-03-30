import { useCallback, useEffect, useState } from 'react'
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
  const [incoming, setIncoming] = useState<IncomingDrag | null>(null)
  const [hoverZone, setHoverZone] = useState<HoverZone>(null)
  const [mouseOver, setMouseOver] = useState(false)
  const windowId = getWindowId()

  // Convert screen coordinates to a zone in this window
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

  const handleDrop = useCallback((drag: IncomingDrag, zone: PanelPosition) => {
    broadcast({
      type: 'drag-drop',
      panelId: drag.panelId,
      panelIds: drag.panelIds,
      targetWindow: windowId,
      position: zone,
      groupKey: null,
    })

    const store = useLayoutStore.getState()
    for (const id of drag.panelIds) {
      store.removePanel(id)
    }
    store.addPanel(drag.panelIds[0], zone)
    for (let i = 1; i < drag.panelIds.length; i++) {
      store.addPanel(drag.panelIds[i], zone)
      store.movePanelToTab(drag.panelIds[i], drag.panelIds[0])
    }
  }, [windowId])

  useEffect(() => {
    let currentIncoming: IncomingDrag | null = null
    let currentZone: HoverZone = null
    let isOver = false

    const unsub = onMessage((msg: ChannelMessage) => {
      if (msg.type === 'drag-start' && msg.sourceWindow !== windowId) {
        currentIncoming = { panelId: msg.panelId, panelIds: msg.panelIds, sourceWindow: msg.sourceWindow }
        setIncoming(currentIncoming)
      } else if (msg.type === 'drag-move' && msg.sourceWindow !== windowId && currentIncoming) {
        const result = detectZoneFromScreen(msg.screenX, msg.screenY)
        currentZone = result.zone
        isOver = result.isOver
        setHoverZone(currentZone)
        setMouseOver(isOver)
      } else if (msg.type === 'drag-end' && msg.sourceWindow !== windowId) {
        if (currentIncoming && isOver && currentZone) {
          handleDrop(currentIncoming, currentZone)
        }
        currentIncoming = null
        currentZone = null
        isOver = false
        setIncoming(null)
        setHoverZone(null)
        setMouseOver(false)
      }
    })

    return () => { unsub() }
  }, [windowId, detectZoneFromScreen, handleDrop])

  if (!incoming) return null

  const zoneClass = (zone: PanelPosition) => {
    if (hoverZone === zone) return 'border-primary/60 bg-primary/15'
    if (mouseOver) return 'border-transparent'
    return 'border-transparent'
  }

  return (
    <div className="absolute inset-0 z-50 pointer-events-none">
      <div className={`absolute left-0 top-0 w-1/4 h-3/4 border-2 border-dashed rounded-sm transition-colors ${zoneClass('left')}`} />
      <div className={`absolute right-0 top-0 w-1/4 h-3/4 border-2 border-dashed rounded-sm transition-colors ${zoneClass('right')}`} />
      <div className={`absolute left-0 bottom-0 w-full h-1/4 border-2 border-dashed rounded-sm transition-colors ${zoneClass('bottom')}`} />
      {hoverZone && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="bg-background/90 backdrop-blur-sm px-4 py-2 rounded-lg border border-primary/40 shadow-lg">
            <span className="text-sm text-muted-foreground">
              Drop in {hoverZone} panel
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
