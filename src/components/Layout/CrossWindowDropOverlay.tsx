import { useCallback, useEffect, useRef } from 'react'
import { onMessage, broadcast, type ChannelMessage } from '@/services/channel'
import { getWindowId } from '@/services/platform'
import { useLayoutStore, type PanelPosition } from '@/store/layout'

type HoverZone = PanelPosition | null

const CLAIM_TIMEOUT = 150 // ms to wait for competing claims

interface Props {
  zoneRefs: React.RefObject<Record<PanelPosition, HTMLDivElement | null>>
  mode?: 'main' | 'panel'
}

export default function CrossWindowDropOverlay({ zoneRefs, mode = 'main' }: Props) {
  const windowId = getWindowId()
  const setCrossWindowDrag = useLayoutStore((s) => s.setCrossWindowDrag)
  const focusedAtRef = useRef(Date.now())

  // Track when this window was last focused
  useEffect(() => {
    const handleFocus = () => { focusedAtRef.current = Date.now() }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [])

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
      zone = x < 0.5 ? 'left' : 'right'
    } else {
      if (y > 0.75) zone = 'bottom'
      else if (x < 0.25) zone = 'left'
      else if (x > 0.75) zone = 'right'
    }

    return { zone, isOver: true }
  }, [mode])

  const computeInsertFromScreen = useCallback((zone: PanelPosition, screenX: number, screenY: number): { insertIndex: number; neighborIndex: number } => {
    const el = zoneRefs.current[zone]
    if (!el) return { insertIndex: 0, neighborIndex: 0 }

    const rect = el.getBoundingClientRect()
    const isVertical = zone === 'left' || zone === 'right'

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
    let bestClaim: { windowId: string; focusedAt: number } | null = null
    let claimTimer: ReturnType<typeof setTimeout> | null = null

    const unsub = onMessage((msg: ChannelMessage) => {
      if (msg.type === 'drag-start' && msg.sourceWindow !== windowId) {
        currentIncoming = { panelId: msg.panelId, panelIds: msg.panelIds, sourceWindow: msg.sourceWindow }
        bestClaim = null
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
          // Broadcast our claim with focus timestamp
          const myClaim = { windowId, focusedAt: focusedAtRef.current }
          bestClaim = myClaim
          broadcast({ type: 'drag-claim', ...myClaim })

          // Wait for competing claims, then drop if we win
          if (claimTimer) clearTimeout(claimTimer)
          claimTimer = setTimeout(() => {
            if (!bestClaim || bestClaim.windowId !== windowId || !currentIncoming || !currentZone) {
              // Lost the claim or state was cleared
              currentIncoming = null
              currentZone = null
              isOver = false
              bestClaim = null
              setCrossWindowDrag(null)
              return
            }

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

            currentIncoming = null
            currentZone = null
            isOver = false
            bestClaim = null
            setCrossWindowDrag(null)
          }, CLAIM_TIMEOUT)
        } else {
          currentIncoming = null
          currentZone = null
          isOver = false
          bestClaim = null
          setCrossWindowDrag(null)
        }
      } else if (msg.type === 'drag-claim' && msg.windowId !== windowId) {
        // Another window is claiming — compare focus timestamps (higher = more recent = wins)
        if (bestClaim && msg.focusedAt > bestClaim.focusedAt) {
          // They win — back off
          bestClaim = { windowId: msg.windowId, focusedAt: msg.focusedAt }
          if (claimTimer) {
            clearTimeout(claimTimer)
            claimTimer = null
          }
          setCrossWindowDrag(null)
        }
      }
    })

    return () => {
      unsub()
      if (claimTimer) clearTimeout(claimTimer)
      setCrossWindowDrag(null)
    }
  }, [windowId, detectZoneFromScreen, computeInsertFromScreen, setCrossWindowDrag])

  return null
}
