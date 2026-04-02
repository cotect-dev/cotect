import { useEffect, useState } from 'react'
import { getPlatform } from '@/services/platform'
import { loadLayout, loadGeometry, loadSession, getChildWindowIds, removeLayout, startGeometryPersistence, stopGeometryPersistence, startSessionPersistence, stopSessionPersistence, restoreGeometryOnMonitor } from '@/services/windowManager'
import { useBrowserStore } from '@/store/browser'
import { useGitStore, startGitWatcher, stopGitWatcher } from '@/store/git'
import { loadLayoutIntoStore, startLayoutPersistence, stopLayoutPersistence } from '@/store/layout'
import { initAllSyncedStores, clearAllSyncedStores, stopAllSyncedStores } from '@/store/synced'
import { DEFAULT_MAIN_LAYOUT } from '@/lib/constants'

export function useWindowLifecycle() {
  const [isReady, setIsReady] = useState(false)
  const platform = getPlatform()
  const windowId = platform.windows.getWindowId()
  const isMain = windowId === 'main'

  useEffect(() => {
    platform.windows.setMinSize(isMain ? 1280 : 400, isMain ? 720 : 300)
    if (isMain) clearAllSyncedStores()
    initAllSyncedStores()
    return () => { stopAllSyncedStores() }
  }, [])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const [saved, geo, childIds, session] = await Promise.all([
        loadLayout(windowId),
        loadGeometry(windowId),
        isMain ? getChildWindowIds() : [],
        loadSession(),
      ])
      if (cancelled) return

      await startGeometryPersistence(windowId)

      if (geo) {
        await restoreGeometryOnMonitor(windowId, geo, platform)
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
          const dpr = window.devicePixelRatio || 1
          const isWayland = await platform.isWayland()
          for (let i = 0; i < childIds.length; i++) {
            const geo = geometries[i]
            // Don't call restoreGeometryOnMonitor from the parent —
            // move() targets the current window, not the child.
            const hasPosition = geo && (isWayland ? !!geo.monitorInfo : true)
            await platform.windows.create(childIds[i], geo ? {
              width: Math.round(geo.width / dpr),
              height: Math.round(geo.height / dpr),
              x: hasPosition ? Math.round(geo.x / dpr) : undefined,
              y: hasPosition ? Math.round(geo.y / dpr) : undefined,
              center: !hasPosition,
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
          } catch (err) {
            console.error('Failed to restore session root:', err)
          }
        }
        startSessionPersistence()

        useBrowserStore.subscribe((state) => {
          const gitState = useGitStore.getState()
          if (state.rootPath && state.rootPath !== gitState.repoPath) {
            gitState.setRepoPath(state.rootPath)
            stopGitWatcher()
            startGitWatcher(state.rootPath, windowId)
            gitState.refresh()
          }
        })

        // Initialize git for the already-restored session (subscription above
        // only fires on *future* changes, so we need to handle the current state)
        const currentRoot = useBrowserStore.getState().rootPath
        if (currentRoot && currentRoot !== useGitStore.getState().repoPath) {
          useGitStore.getState().setRepoPath(currentRoot)
          startGitWatcher(currentRoot, windowId)
          useGitStore.getState().refresh()
        }
      }

      if (session?.rootPath && !isMain) {
        useGitStore.getState().setRepoPath(session.rootPath)
        startGitWatcher(session.rootPath, windowId)
        useGitStore.getState().refresh()
      }

      platform.ipc.emit('window-opened', { windowId }).catch(() => {})

      setIsReady(true)
    })()

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (isMain) return
    return platform.ipc.listen('window-closed', (payload: unknown) => {
      const { windowId: closedId } = payload as { windowId: string }
      if (closedId === 'main') platform.windows.close()
    })
  }, [])

  useEffect(() => {
    return platform.windows.onClose(() => {
      stopLayoutPersistence()
      stopGeometryPersistence()
      stopSessionPersistence()
      stopAllSyncedStores()
      stopGitWatcher()
      if (!isMain) removeLayout(windowId)
      platform.ipc.emit('window-closed', { windowId }).catch(() => {})
    })
  }, [])

  useEffect(() => {
    return () => {
      stopLayoutPersistence()
      stopGeometryPersistence()
      stopSessionPersistence()
      stopGitWatcher()
    }
  }, [])

  return { isMain, isReady }
}
