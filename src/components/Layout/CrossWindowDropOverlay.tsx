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
  const [mouseInWindow, setMouseInWindow] = useState(false)
  const windowId = getWindowId()

  // Detect zone from mouse position
  const detectZone = useCallback((clientX: number, clientY: number): HoverZone => {
    const w = window.innerWidth
    const h = window.innerHeight
    const x = clientX / w
    const y = clientY / h

    if (y > 0.75) return 'bottom'
    if (x < 0.25) return 'left'
    if (x > 0.75) return 'right'
    return null
  }, [])

  // Handle drop: add panels to this window's store
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

  // Listen for cross-window drag messages
  useEffect(() => {
    let currentIncoming: IncomingDrag | null = null
    let currentZone: HoverZone = null
    let isMouseInWindow = false

    const unsub = onMessage((msg: ChannelMessage) => {
      if (msg.type === 'drag-start' && msg.sourceWindow !== windowId) {
        currentIncoming = { panelId: msg.panelId, panelIds: msg.panelIds, sourceWindow: msg.sourceWindow }
        setIncoming(currentIncoming)
      } else if (msg.type === 'drag-end' && msg.sourceWindow !== windowId) {
        // Source released the mouse. If our mouse is over a valid zone, drop here.
        if (currentIncoming && isMouseInWindow && currentZone) {
          handleDrop(currentIncoming, currentZone)
        }
        currentIncoming = null
        currentZone = null
        isMouseInWindow = false
        setIncoming(null)
        setHoverZone(null)
        setMouseInWindow(false)
      }
    })

    // Track mouse position — no button check needed.
    // We know a drag is active via IPC, so any mouse movement is drag-hover.
    const handleMouseMove = (e: MouseEvent) => {
      if (!currentIncoming) return
      isMouseInWindow = true
      currentZone = detectZone(e.clientX, e.clientY)
      setMouseInWindow(true)
      setHoverZone(currentZone)
    }

    const handleMouseLeave = () => {
      if (!currentIncoming) return
      isMouseInWindow = false
      currentZone = null
      setMouseInWindow(false)
      setHoverZone(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      unsub()
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [windowId, detectZone, handleDrop])

  if (!incoming) return null

  return (
    <div className="absolute inset-0 z-50 pointer-events-none">
      {/* Left zone highlight */}
      <div
        className={`absolute left-0 top-0 w-1/4 h-3/4 border-2 border-dashed rounded-sm transition-colors ${
          hoverZone === 'left' ? 'border-primary/60 bg-primary/10' : 'border-transparent'
        }`}
      />
      {/* Right zone highlight */}
      <div
        className={`absolute right-0 top-0 w-1/4 h-3/4 border-2 border-dashed rounded-sm transition-colors ${
          hoverZone === 'right' ? 'border-primary/60 bg-primary/10' : 'border-transparent'
        }`}
      />
      {/* Bottom zone highlight */}
      <div
        className={`absolute left-0 bottom-0 w-full h-1/4 border-2 border-dashed rounded-sm transition-colors ${
          hoverZone === 'bottom' ? 'border-primary/60 bg-primary/10' : 'border-transparent'
        }`}
      />
      {/* Center label */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="bg-background/90 backdrop-blur-sm px-4 py-2 rounded-lg border border-primary/40 shadow-lg">
          <span className="text-sm text-muted-foreground">
            {!mouseInWindow
              ? `Dragging: ${incoming.panelIds.join(', ')}`
              : hoverZone
                ? `Drop in ${hoverZone} panel`
                : 'Move to a zone to drop'}
          </span>
        </div>
      </div>
    </div>
  )
}
