import { useEffect, useState } from 'react'
import { getPlatform } from '@/services/platform'
import { loadLayout, loadGeometry, loadSession, getChildWindowIds, removeLayout, startGeometryPersistence, stopGeometryPersistence, startSessionPersistence, stopSessionPersistence, restoreGeometryOnMonitor } from '@/services/windowManager'
import { useBrowserStore } from '@/store/browser'
import { useGitStore, startGitWatcher, stopGitWatcher } from '@/store/git'
import { loadLayoutIntoStore, startLayoutPersistence, stopLayoutPersistence } from '@/store/layout'
import { DEFAULT_MAIN_LAYOUT } from '@/lib/constants'
import { initPersistence, stopPersistence, flushPendingWrites, switchProject } from '@/store/persistence'
import { computeProjectId } from '@/lib/projectId'

export function useWindowLifecycle() {
  const [isReady, setIsReady] = useState(false)
  const platform = getPlatform()
  const windowId = platform.windows.getWindowId()
  const isMain = windowId === 'main'

  useEffect(() => {
    void platform.windows.setMinSize(isMain ? 1280 : 400, isMain ? 720 : 300)
    return () => {
      stopPersistence()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false

    void (async () => {
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
        if (isMain) {
          await platform.windows.resize(geo.width, geo.height).catch((err) => {
            console.warn('[windowLifecycle] resize during restore failed:', err)
          })
        }
        if (geo.isMaximized) {
          await platform.windows.maximize().catch((err) => {
            console.warn('[windowLifecycle] maximize during restore failed:', err)
          })
        }
      }

      loadLayoutIntoStore(saved ?? (isMain ? DEFAULT_MAIN_LAYOUT : { panels: { left: [], right: [], bottom: [] }, sizes: { left: [], right: [], bottom: [] }, activeTab: {} }))
      startLayoutPersistence(windowId)

      if (isMain) void platform.windows.show()
      const splash = document.getElementById('splash')
      if (splash) {
        splash.classList.add('hide')
        setTimeout(() => splash.remove(), 100)
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
            useBrowserStore.getState().openRoot(session.rootPath)
            if (cancelled) return
          } catch (err) {
            console.error('Failed to restore session root:', err)
          }
        }
        startSessionPersistence()

        const rootPath = session?.rootPath || useBrowserStore.getState().rootPath
        if (rootPath) {
          const projectId = await computeProjectId(rootPath)
          await initPersistence(projectId)
        }

        useBrowserStore.subscribe((state) => {
          const gitState = useGitStore.getState()
          if (state.rootPath && state.rootPath !== gitState.repoPath) {
            gitState.setRepoPath(state.rootPath)
            stopGitWatcher()
            startGitWatcher(state.rootPath, windowId)
            computeProjectId(state.rootPath).then((newProjectId) => {
              switchProject(newProjectId).catch((err) => {
                console.warn('[windowLifecycle] persistence project switch failed:', err)
              })
            }).catch((err) => {
              console.warn('[windowLifecycle] project ID computation failed:', err)
            })
            gitState.refresh().catch((err) => {
              console.warn('[windowLifecycle] git refresh after root change failed:', err)
            })
          }
        })

        // Initialize git for the already-restored session (subscription above
        // only fires on *future* changes, so we need to handle the current state)
        const currentRoot = useBrowserStore.getState().rootPath
        if (currentRoot && currentRoot !== useGitStore.getState().repoPath) {
          useGitStore.getState().setRepoPath(currentRoot)
          startGitWatcher(currentRoot, windowId)
          useGitStore.getState().refresh().catch((err) => {
            console.warn('[windowLifecycle] git refresh during restore failed:', err)
          })
        }
      }

      if (session?.rootPath && !isMain) {
        useGitStore.getState().setRepoPath(session.rootPath)
        startGitWatcher(session.rootPath, windowId)
        useGitStore.getState().refresh().catch((err) => {
          console.warn('[windowLifecycle] git refresh on child window restore failed:', err)
        })
      }

      platform.ipc.emit('window-opened', { windowId }).catch((err) => {
        console.warn('[windowLifecycle] window-opened emit failed:', err)
      })

      setIsReady(true)
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isMain) return
    return platform.ipc.listen('window-closed', (payload: unknown) => {
      const { windowId: closedId } = payload as { windowId: string }
      if (closedId === 'main') void platform.windows.close()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return platform.windows.onClose(() => {
      flushPendingWrites()
      stopLayoutPersistence()
      stopGeometryPersistence()
      stopSessionPersistence()
      stopGitWatcher()
      if (!isMain) removeLayout(windowId)
      platform.ipc.emit('window-closed', { windowId }).catch((err) => {
        console.warn('[windowLifecycle] window-closed emit failed:', err)
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
