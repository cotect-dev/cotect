import { useCallback, useEffect, useState } from 'react'
import { getPlatform } from '@/services/platform'
import { useLayoutStore, type PanelPosition } from '@/store/layout'
import { useWindowBounds } from '@/hooks/useWindowBounds'
import { reloadStoreFromBackend } from '@/store/persistence'
import { computeInsertIndex as computeInsertIndexMath, detectDropZone } from '@/lib/panelDropMath'

type HoverZone = PanelPosition | null

interface Props {
  zoneRefs: React.RefObject<Record<PanelPosition, HTMLDivElement | null>>
  mode?: 'main' | 'panel'
}

export default function CrossWindowDropOverlay({ zoneRefs, mode = 'main' }: Props) {
  const platform = getPlatform()
  const windowId = platform.windows.getWindowId()
  const setCrossWindowDrag = useLayoutStore((s) => s.setCrossWindowDrag)
  const windowBoundsRef = useWindowBounds()
  const [isWayland, setIsWayland] = useState<boolean | null>(null)

  useEffect(() => {
    platform
      .isWayland()
      .then(setIsWayland)
      .catch((err) => {
        console.warn('[crossWindowDropOverlay] isWayland check failed:', err)
      })
  }, [platform])

  const detectZone = useCallback(
    (clientX: number, clientY: number): HoverZone => {
      return detectDropZone(clientX, clientY, window.innerWidth, window.innerHeight, mode)
    },
    [mode],
  )

  const detectZoneFromScreen = useCallback(
    (screenX: number, screenY: number): HoverZone => {
      const bounds = windowBoundsRef.current
      if (
        screenX < bounds.left ||
        screenX > bounds.right ||
        screenY < bounds.top ||
        screenY > bounds.bottom
      ) {
        return null
      }
      const contentWidth = bounds.right - bounds.left
      const contentHeight = bounds.bottom - bounds.top
      return detectDropZone(
        screenX - bounds.left,
        screenY - bounds.top,
        contentWidth,
        contentHeight,
        mode,
      )
    },
    [mode, windowBoundsRef],
  )

  const computeInsertFromClient = useCallback(
    (
      zone: PanelPosition,
      clientX: number,
      clientY: number,
    ): { insertIndex: number; neighborIndex: number } => {
      const el = zoneRefs.current[zone]
      if (!el) return { insertIndex: 0, neighborIndex: 0 }

      const rect = el.getBoundingClientRect()
      const isVertical = zone === 'left' || zone === 'right'
      const sizes = useLayoutStore.getState().sizes[zone]

      return computeInsertIndexMath({ rect, isVertical }, sizes, clientX, clientY)
    },
    [zoneRefs],
  )

  useEffect(() => {
    if (isWayland === null) return

    let currentIncoming: { panelId: string; panelIds: string[]; sourceWindow: string } | null = null
    let currentZone: HoverZone = null
    let lastAccepted: { panelIds: string[] } | null = null

    const handlePointerMove = (e: PointerEvent) => {
      if (!currentIncoming) return
      const zone = detectZone(e.clientX, e.clientY)
      currentZone = zone
      if (zone) {
        const { insertIndex, neighborIndex } = computeInsertFromClient(zone, e.clientX, e.clientY)
        setCrossWindowDrag({
          panelId: currentIncoming.panelIds[0],
          panelIds: currentIncoming.panelIds,
          position: zone,
          insertIndex,
          neighborIndex,
        })
      } else {
        setCrossWindowDrag(null)
      }
    }

    const handlePointerLeave = () => {
      if (!currentIncoming) return
      currentZone = null
      setCrossWindowDrag(null)
    }

    const unlistenStart = platform.ipc.listen('drag-start', (payload: unknown) => {
      const msg = payload as { panelId: string; panelIds: string[]; sourceWindow: string }
      if (msg.sourceWindow !== windowId) {
        currentIncoming = {
          panelId: msg.panelId,
          panelIds: msg.panelIds,
          sourceWindow: msg.sourceWindow,
        }
        lastAccepted = null
        document.addEventListener('pointermove', handlePointerMove)
        document.addEventListener('pointerleave', handlePointerLeave)
      } else {
        lastAccepted = null
      }
    })

    const unlistenMove = platform.ipc.listen('drag-move', (payload: unknown) => {
      if (isWayland) return

      const msg = payload as { screenX: number; screenY: number; sourceWindow: string }
      if (msg.sourceWindow !== windowId && currentIncoming) {
        const zone = detectZoneFromScreen(msg.screenX, msg.screenY)
        const bounds = windowBoundsRef.current
        const clientX = msg.screenX - bounds.left
        const clientY = msg.screenY - bounds.top
        currentZone = zone
        if (zone) {
          const { insertIndex, neighborIndex } = computeInsertFromClient(zone, clientX, clientY)
          setCrossWindowDrag({
            panelId: currentIncoming.panelIds[0],
            panelIds: currentIncoming.panelIds,
            position: zone,
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
        if (currentIncoming && currentZone) {
          const cwd = useLayoutStore.getState().crossWindowDrag
          const insertIndex = cwd?.insertIndex ?? 0
          const neighborIndex = cwd?.neighborIndex ?? 0

          void platform.ipc.emit('drag-drop', {
            panelId: currentIncoming.panelId,
            panelIds: currentIncoming.panelIds,
            targetWindow: windowId,
            sourceWindow: currentIncoming.sourceWindow,
            focusedAt: Date.now(),
            position: currentZone,
            groupKey: null,
          })

          useLayoutStore
            .getState()
            .moveGroup(currentIncoming.panelIds, currentZone, insertIndex, neighborIndex)
          for (const id of currentIncoming.panelIds) {
            void reloadStoreFromBackend(id)
          }
          lastAccepted = { panelIds: [...currentIncoming.panelIds] }
        }

        document.removeEventListener('pointermove', handlePointerMove)
        document.removeEventListener('pointerleave', handlePointerLeave)
        currentIncoming = null
        currentZone = null
        setCrossWindowDrag(null)
      }
    })

    const unlistenDrop = platform.ipc.listen('drag-drop', (payload: unknown) => {
      const msg = payload as { targetWindow: string; sourceWindow: string }
      if (msg.targetWindow !== windowId && lastAccepted) {
        if (windowId === msg.sourceWindow) {
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
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerleave', handlePointerLeave)
      setCrossWindowDrag(null)
    }
  }, [
    windowId,
    isWayland,
    detectZone,
    detectZoneFromScreen,
    computeInsertFromClient,
    setCrossWindowDrag,
    platform,
    windowBoundsRef,
  ])

  return null
}
