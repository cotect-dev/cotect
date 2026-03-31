import { useEffect, useState } from 'react'
import { window as neuWindow } from '@neutralinojs/lib'
import { getWindowId, onWindowClose, closeWindow, createWindow, killChildWindows, setWindowSizeConstraints, showWindow, isNeutralino } from '@/services/platform'
import { broadcast, closeChannel, initChannel, onMessage } from '@/services/channel'
import { loadLayout, loadGeometry, loadSession, getChildWindowIds, removeLayout, startGeometryPersistence, stopGeometryPersistence, startSessionPersistence, stopSessionPersistence } from '@/services/windowManager'
import { useBrowserStore } from '@/store/browser'
import { loadLayoutIntoStore, startLayoutPersistence, stopLayoutPersistence } from '@/store/layout'
import { initAllSyncedStores, clearAllSyncedStores } from '@/store/synced'

const windowId = getWindowId()
const isMain = windowId === 'main'

const DEFAULT_MAIN_LAYOUT = {
  panels: { left: [['explorer']], right: [['chat']], bottom: [['console']] },
  sizes: { left: [1], right: [1], bottom: [1] },
  activeTab: {},
}

export function useWindowLifecycle() {
  const [isReady, setIsReady] = useState(false)

  // One-time channel + store init
  useEffect(() => {
    setWindowSizeConstraints(isMain ? 1280 : 400, isMain ? 720 : 300)
    initChannel(windowId)
    if (isMain) clearAllSyncedStores()
    initAllSyncedStores()
    return () => { closeChannel() }
  }, [])

  // Async state restoration
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const [saved, geo, childIds, session] = await Promise.all([
        loadLayout(windowId),
        isNeutralino() ? loadGeometry(windowId) : null,
        isMain ? getChildWindowIds() : [],
        isMain ? loadSession() : null,
      ])
      if (cancelled) return

      startGeometryPersistence(windowId)

      if (isNeutralino() && geo) {
        await neuWindow.move(geo.x, geo.y).catch(() => {})
        if (isMain) await neuWindow.setSize({ width: geo.width, height: geo.height }).catch(() => {})
        if (geo.isMaximized) await neuWindow.maximize().catch(() => {})
      }

      loadLayoutIntoStore(saved ?? (isMain ? DEFAULT_MAIN_LAYOUT : { panels: { left: [], right: [], bottom: [] }, sizes: { left: [], right: [], bottom: [] }, activeTab: {} }))
      startLayoutPersistence(windowId)

      if (isMain) showWindow()
      const splash = document.getElementById('splash')
      if (splash) {
        splash.classList.add('hide')
        setTimeout(() => splash.remove(), 200)
      }

      if (isMain) {
        if (childIds.length > 0) {
          const geometries = await Promise.all(childIds.map((id) => loadGeometry(id)))
          if (cancelled) return
          for (let i = 0; i < childIds.length; i++) createWindow(childIds[i], geometries[i])
        }

        if (session?.rootPath) {
          try {
            await useBrowserStore.getState().openRoot(session.rootPath)
            if (cancelled) return
            if (session.currentPath && session.currentPath !== session.rootPath) {
              await useBrowserStore.getState().navigateTo(session.currentPath, session.viewMode)
            }
          } catch {
            // Root path no longer exists — skip
          }
        }
        startSessionPersistence()
      }

      setIsReady(true)
    })()

    void broadcast({ type: 'window-opened', windowId })

    return () => { cancelled = true }
  }, [])

  // Child window: close when main closes
  useEffect(() => {
    if (isMain) return
    return onMessage((msg) => {
      if (msg.type === 'window-closed' && msg.windowId === 'main') closeWindow()
    })
  }, [])

  // Window close handler
  useEffect(() => {
    return onWindowClose(() => {
      stopLayoutPersistence()
      stopGeometryPersistence()
      stopSessionPersistence()
      if (!isMain) removeLayout(windowId)
      if (isMain) killChildWindows()
      closeChannel()
      closeWindow()
    })
  }, [])

  // Cleanup persistence on unmount
  useEffect(() => {
    return () => {
      stopLayoutPersistence()
      stopGeometryPersistence()
      stopSessionPersistence()
    }
  }, [])

  return { isMain, isReady }
}
