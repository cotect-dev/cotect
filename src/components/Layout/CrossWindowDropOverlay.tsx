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

  // Listen for cross-window drag messages
  useEffect(() => {
    return onMessage((msg: ChannelMessage) => {
      if (msg.type === 'drag-start' && msg.sourceWindow !== windowId) {
        setIncoming({ panelId: msg.panelId, panelIds: msg.panelIds, sourceWindow: msg.sourceWindow })
      } else if (msg.type === 'drag-end' && msg.sourceWindow !== windowId) {
        setIncoming(null)
        setHoverZone(null)
        setMouseInWindow(false)
      }
    })
  }, [windowId])

  // Detect zone from mouse position
  const detectZone = useCallback((clientX: number, clientY: number): HoverZone => {
    const w = window.innerWidth
    const h = window.innerHeight
    const x = clientX / w
    const y = clientY / h

    // Bottom 25%
    if (y > 0.75) return 'bottom'
    // Left 25%
    if (x < 0.25) return 'left'
    // Right 25%
    if (x > 0.75) return 'right'

    return null
  }, [])

  // Track mouse movement when incoming drag is active
  useEffect(() => {
    if (!incoming) return

    const handleMouseMove = (e: MouseEvent) => {
      // Only track if a mouse button is held (cross-window drag in progress)
      if (e.buttons > 0) {
        setMouseInWindow(true)
        setHoverZone(detectZone(e.clientX, e.clientY))
      }
    }

    const handleMouseEnter = (e: MouseEvent) => {
      if (e.buttons > 0) {
        setMouseInWindow(true)
      } else {
        // Mouse entered without button — drag was released outside, clean up
        setIncoming(null)
        setHoverZone(null)
        setMouseInWindow(false)
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (!incoming || !mouseInWindow) return

      const zone = detectZone(e.clientX, e.clientY)
      if (zone) {
        // Broadcast drop to source window and handle locally
        broadcast({
          type: 'drag-drop',
          panelId: incoming.panelId,
          panelIds: incoming.panelIds,
          targetWindow: windowId,
          position: zone,
          groupKey: null,
        })

        // Add panels to this window's store (as a tabbed group)
        // Remove existing panels first to avoid silent no-ops from addPanel's guard
        const store = useLayoutStore.getState()
        for (const id of incoming.panelIds) {
          store.removePanel(id)
        }
        store.addPanel(incoming.panelIds[0], zone)
        for (let i = 1; i < incoming.panelIds.length; i++) {
          store.addPanel(incoming.panelIds[i], zone)
          store.movePanelToTab(incoming.panelIds[i], incoming.panelIds[0])
        }
      }

      setIncoming(null)
      setHoverZone(null)
      setMouseInWindow(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseenter', handleMouseEnter)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseenter', handleMouseEnter)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [incoming, mouseInWindow, detectZone, windowId])

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
              ? `Dragging: ${incoming.panelIds.join(', ')} — move mouse here`
              : hoverZone
                ? `Drop in ${hoverZone} panel`
                : 'Move to a zone to drop'}
          </span>
        </div>
      </div>
    </div>
  )
}
