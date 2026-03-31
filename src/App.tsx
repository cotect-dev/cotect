import { useEffect } from 'react'
import Canvas from '@/views/Canvas'
import NewWindow from '@/views/NewWindow'
import { window as neuWindow } from '@neutralinojs/lib'
import { getWindowId, onWindowClose, closeWindow, createWindow, killChildWindows, setWindowSizeConstraints, showWindow, isNeutralino } from '@/services/platform'
import { broadcast, closeChannel, initChannel, onMessage } from '@/services/channel'
import { loadLayout, loadGeometry, loadSession, getChildWindowIds, removeLayout, startGeometryPersistence, stopGeometryPersistence, startSessionPersistence, stopSessionPersistence } from '@/services/windowManager'
import { useBrowserStore } from '@/store/browser'
import {
  loadLayoutIntoStore,
  startLayoutPersistence,
  stopLayoutPersistence,
} from '@/store/layout'
import { initAllSyncedStores, clearAllSyncedStores } from '@/store/synced'

const windowId = getWindowId()
const isMain = windowId === 'main'

const DEFAULT_MAIN_LAYOUT = {
  panels: { left: [['explorer']], right: [['chat']], bottom: [['console']] },
  sizes: { left: [1], right: [1], bottom: [1] },
  activeTab: {},
}

function App() {
  useEffect(() => {
    let cancelled = false

    // Set window size constraints
    setWindowSizeConstraints(isMain ? 1280 : 400, isMain ? 720 : 300)

    // Initialize cross-window channel
    initChannel(windowId)

    // Clear stale panel state from previous session (main window only),
    // then start auto-saving. Panel state is session-scoped, not persistent.
    if (isMain) {
      clearAllSyncedStores()
    }
    initAllSyncedStores()

    // Async init: load all persisted state in parallel, then apply.
    // Splash screen stays visible until layout is applied so the user
    // sees content instead of an empty frame.
    ;(async () => {
      // Fire all reads concurrently — layout, geometry, children, session
      const layoutP = loadLayout(windowId)
      const geoP = isNeutralino() ? loadGeometry(windowId) : Promise.resolve(null)
      const childrenP = isMain ? getChildWindowIds() : Promise.resolve([] as string[])
      const sessionP = isMain ? loadSession() : Promise.resolve(null)

      const [saved, geo, childIds, session] = await Promise.all([
        layoutP, geoP, childrenP, sessionP,
      ])
      if (cancelled) return

      // Restore geometry and show main window first (minimizes blank time)
      startGeometryPersistence(windowId)
      if (isNeutralino() && geo) {
        await neuWindow.move(geo.x, geo.y).catch(() => {})
        if (isMain) {
          await neuWindow.setSize({ width: geo.width, height: geo.height }).catch(() => {})
        }
        if (geo.isMaximized) {
          await neuWindow.maximize().catch(() => {})
        }
      }

      // Apply layout, then dismiss splash
      if (saved) {
        loadLayoutIntoStore(saved)
      } else if (isMain) {
        loadLayoutIntoStore(DEFAULT_MAIN_LAYOUT)
      }
      startLayoutPersistence(windowId)

      // Show window and remove splash now that layout is ready
      if (isMain) showWindow()
      const splash = document.getElementById('splash')
      if (splash) {
        splash.classList.add('hide')
        setTimeout(() => splash.remove(), 200)
      }

      if (isMain) {
        // Fire off child window creates immediately — load their geometries in parallel
        if (childIds.length > 0) {
          const geometries = await Promise.all(childIds.map(id => loadGeometry(id)))
          if (cancelled) return
          for (let i = 0; i < childIds.length; i++) {
            createWindow(childIds[i], geometries[i])
          }
        }

        // Restore browser session
        if (session?.rootPath) {
          try {
            await useBrowserStore.getState().openRoot(session.rootPath)
            if (cancelled) return
            if (session.currentPath && session.currentPath !== session.rootPath) {
              await useBrowserStore.getState().navigateTo(session.currentPath, session.viewMode)
            }
          } catch {
            // Root path no longer exists on disk — skip restoration
          }
        }
        startSessionPersistence()
      }
    })()

    broadcast({ type: 'window-opened', windowId })

    // Child windows: close when main window closes
    const unsubMessage = !isMain ? onMessage((msg) => {
      if (msg.type === 'window-closed' && msg.windowId === 'main') {
        closeWindow()
      }
    }) : undefined

    // Handle this window closing
    // windowClose fires on explicit close (X button / Exit menu).
    // When neu-dev.js kills children via SIGKILL, this does NOT fire —
    // so their layout files persist for next startup.
    const unsubClose = onWindowClose(() => {
      stopLayoutPersistence()
      stopGeometryPersistence()
      stopSessionPersistence()
      if (!isMain) {
        // User explicitly closed this child — remove layout so it doesn't restore
        removeLayout(windowId)
      }
      if (isMain) {
        killChildWindows()
      }
      closeChannel()
      closeWindow()
    })

    return () => {
      cancelled = true
      unsubMessage?.()
      unsubClose()
      stopLayoutPersistence()
      stopGeometryPersistence()
      stopSessionPersistence()
    }
  }, [])

  if (!isMain) return <NewWindow />
  return <Canvas />
}

export default App
