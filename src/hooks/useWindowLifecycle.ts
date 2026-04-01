import { useEffect, useState } from 'react'
import { getPlatform } from '@/services/platform'
import { loadLayout, loadGeometry, loadSession, getChildWindowIds, removeLayout, startGeometryPersistence, stopGeometryPersistence, startSessionPersistence, stopSessionPersistence } from '@/services/windowManager'
import { useBrowserStore } from '@/store/browser'
import { loadLayoutIntoStore, startLayoutPersistence, stopLayoutPersistence } from '@/store/layout'
import { initAllSyncedStores, clearAllSyncedStores, stopAllSyncedStores } from '@/store/synced'

const DEFAULT_MAIN_LAYOUT = {
  panels: { left: [['explorer']], right: [['chat']], bottom: [['console']] },
  sizes: { left: [1], right: [1], bottom: [1] },
  activeTab: {},
}

export function useWindowLifecycle() {
  const [isReady, setIsReady] = useState(false)
  const platform = getPlatform()
  const windowId = platform.windows.getWindowId()
  const isMain = windowId === 'main'

  // One-time store init
  useEffect(() => {
    platform.windows.setMinSize(isMain ? 1280 : 400, isMain ? 720 : 300)
    if (isMain) clearAllSyncedStores()
    initAllSyncedStores()
    return () => { stopAllSyncedStores() }
  }, [])

  // Async state restoration
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const [saved, geo, childIds, session] = await Promise.all([
        loadLayout(windowId),
        loadGeometry(windowId),
        isMain ? getChildWindowIds() : [],
        isMain ? loadSession() : null,
      ])
      if (cancelled) return

      startGeometryPersistence(windowId)

      if (geo) {
        await platform.windows.move(geo.x, geo.y).catch(() => {})
        if (isMain) await platform.windows.resize(geo.width, geo.height).catch(() => {})
        if (geo.isMaximized) await platform.windows.maximize().catch(() => {})
      }

      loadLayoutIntoStore(saved ?? (isMain ? DEFAULT_MAIN_LAYOUT : { panels: { left: [], right: [], bottom: [] }, sizes: { left: [], right: [], bottom: [] }, activeTab: {} }))
      startLayoutPersistence(windowId)

      if (isMain) platform.windows.show()
      const splash = document.getElementById('splash')
      if (splash) {
        splash.classList.add('hide')
        setTimeout(() => splash.remove(), 200)
      }

      if (isMain) {
        if (childIds.length > 0) {
          const geometries = await Promise.all(childIds.map((id) => loadGeometry(id)))
          if (cancelled) return
          for (let i = 0; i < childIds.length; i++) {
            const geo = geometries[i]
            await platform.windows.create(childIds[i], geo ? {
              x: geo.x,
              y: geo.y,
              width: geo.width,
              height: geo.height,
            } : undefined).catch((err) => {
              console.error('Failed to create window:', err)
            })
          }
        }

        if (session?.rootPath) {
          try {
            await useBrowserStore.getState().openRoot(session.rootPath)
            if (cancelled) return
            if (session.currentPath && session.currentPath !== session.rootPath) {
              await useBrowserStore.getState().navigateTo(session.currentPath, session.viewMode)
            }
          } catch {
            // Root path no longer exists
          }
        }
        startSessionPersistence()
      }

      // Broadcast window-opened
      platform.ipc.emit('window-opened', { windowId }).catch(() => {})

      setIsReady(true)
    })()

    return () => { cancelled = true }
  }, [])

  // Child window: close when main closes
  useEffect(() => {
    if (isMain) return
    return platform.ipc.listen('window-closed', (payload: unknown) => {
      const { windowId: closedId } = payload as { windowId: string }
      if (closedId === 'main') platform.windows.close()
    })
  }, [])

  // Window close handler
  useEffect(() => {
    return platform.windows.onClose(() => {
      stopLayoutPersistence()
      stopGeometryPersistence()
      stopSessionPersistence()
      stopAllSyncedStores()
      if (!isMain) removeLayout(windowId)
      platform.ipc.emit('window-closed', { windowId }).catch(() => {})
      if (isMain) {
        platform.windows.closeAll()
      } else {
        platform.windows.close()
      }
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
