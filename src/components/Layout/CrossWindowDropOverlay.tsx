import { useCallback, useEffect, useRef } from 'react'
import { getPlatform } from '@/services/platform'
import { useLayoutStore, type PanelPosition } from '@/store/layout'
import { reloadSyncedStore } from '@/store/synced'

type HoverZone = PanelPosition | null

interface Props {
  zoneRefs: React.RefObject<Record<PanelPosition, HTMLDivElement | null>>
  mode?: 'main' | 'panel'
}

export default function CrossWindowDropOverlay({ zoneRefs, mode = 'main' }: Props) {
  const platform = getPlatform()
  const windowId = platform.windows.getWindowId()
  const setCrossWindowDrag = useLayoutStore((s) => s.setCrossWindowDrag)
  const windowBoundsRef = useRef({ left: 0, top: 0, right: 0, bottom: 0 })

  // Keep window bounds updated
  useEffect(() => {
    const update = async () => {
      const pos = await platform.windows.getPosition()
      const size = await platform.windows.getSize()
      windowBoundsRef.current = {
        left: pos.x,
        top: pos.y,
        right: pos.x + size.width,
        bottom: pos.y + size.height,
      }
    }
    update()
    const timer = setInterval(update, 500)
    return () => clearInterval(timer)
  }, [platform])

  const detectZoneFromScreen = useCallback((screenX: number, screenY: number): { zone: HoverZone; isOver: boolean } => {
    const bounds = windowBoundsRef.current

    if (screenX < bounds.left || screenX > bounds.right || screenY < bounds.top || screenY > bounds.bottom) {
      return { zone: null, isOver: false }
    }

    const contentWidth = bounds.right - bounds.left
    const contentHeight = bounds.bottom - bounds.top
    const x = (screenX - bounds.left) / contentWidth
    const y = (screenY - bounds.top) / contentHeight

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

  const screenToClient = useCallback((screenX: number, screenY: number) => {
    const bounds = windowBoundsRef.current
    return {
      clientX: screenX - bounds.left,
      clientY: screenY - bounds.top,
    }
  }, [])

  const computeInsertFromScreen = useCallback((zone: PanelPosition, screenX: number, screenY: number): { insertIndex: number; neighborIndex: number } => {
    const el = zoneRefs.current[zone]
    if (!el) return { insertIndex: 0, neighborIndex: 0 }

    const rect = el.getBoundingClientRect()
    const isVertical = zone === 'left' || zone === 'right'

    const { clientX: localX, clientY: localY } = screenToClient(screenX, screenY)

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
  }, [zoneRefs, screenToClient])

  useEffect(() => {
    let currentIncoming: { panelId: string; panelIds: string[]; sourceWindow: string } | null = null
    let currentZone: HoverZone = null
    let isOver = false
    let lastAccepted: { panelIds: string[] } | null = null

    const unlistenStart = platform.ipc.listen('drag-start', (payload: unknown) => {
      const msg = payload as { panelId: string; panelIds: string[]; sourceWindow: string }
      if (msg.sourceWindow !== windowId) {
        currentIncoming = { panelId: msg.panelId, panelIds: msg.panelIds, sourceWindow: msg.sourceWindow }
        lastAccepted = null
      }
    })

    const unlistenMove = platform.ipc.listen('drag-move', (payload: unknown) => {
      const msg = payload as { screenX: number; screenY: number; sourceWindow: string }
      if (msg.sourceWindow !== windowId && currentIncoming) {
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
      }
    })

    const unlistenEnd = platform.ipc.listen('drag-end', (payload: unknown) => {
      const msg = payload as { sourceWindow: string }
      if (msg.sourceWindow !== windowId) {
        if (currentIncoming && isOver && currentZone) {
          const cwd = useLayoutStore.getState().crossWindowDrag
          const insertIndex = cwd?.insertIndex ?? 0
          const neighborIndex = cwd?.neighborIndex ?? 0

          void platform.ipc.emit('drag-drop', {
            panelId: currentIncoming.panelId,
            panelIds: currentIncoming.panelIds,
            targetWindow: windowId,
            focusedAt: Date.now(),
            position: currentZone,
            groupKey: null,
          })

          const store = useLayoutStore.getState()
          for (const id of currentIncoming.panelIds) {
            store.removePanel(id)
          }
          store.moveGroup(currentIncoming.panelIds, currentZone, insertIndex, neighborIndex)
          for (const id of currentIncoming.panelIds) {
            reloadSyncedStore(id)
          }
          lastAccepted = { panelIds: [...currentIncoming.panelIds] }
        }

        currentIncoming = null
        currentZone = null
        isOver = false
        setCrossWindowDrag(null)
      }
    })

    const unlistenDrop = platform.ipc.listen('drag-drop', (payload: unknown) => {
      const msg = payload as { targetWindow: string }
      if (msg.targetWindow !== windowId && lastAccepted) {
        if (msg.targetWindow < windowId) {
          const store = useLayoutStore.getState()
          for (const id of lastAccepted.panelIds) {
            store.removePanel(id)
          }
        }
        lastAccepted = null
      }
    })

    return () => {
      unlistenStart()
      unlistenMove()
      unlistenEnd()
      unlistenDrop()
      setCrossWindowDrag(null)
    }
  }, [windowId, detectZoneFromScreen, computeInsertFromScreen, setCrossWindowDrag, platform])

  return null
}
