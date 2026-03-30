import { useEffect } from 'react'
import Canvas from '@/views/Canvas'
import NewWindow from '@/views/NewWindow'
import { getWindowId, onWindowClose, closeWindow, setWindowSizeConstraints } from '@/services/platform'
import { broadcast, closeChannel, initChannel, onMessage } from '@/services/channel'
import {
  registerWindow,
  unregisterWindow,
  loadLayout,
  getWindows,
  removeLayout,
} from '@/services/windowManager'
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
    // Remove splash screen
    const splash = document.getElementById('splash')
    if (splash) {
      splash.classList.add('hide')
      setTimeout(() => splash.remove(), 200)
    }

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

    // Register this window
    registerWindow(windowId, isMain ? 'main' : 'panel')
    broadcast({ type: 'window-opened', windowId })

    // Load persisted layout (or default for main)
    const saved = loadLayout(windowId)
    if (saved) {
      loadLayoutIntoStore(saved)
    } else if (isMain) {
      loadLayoutIntoStore(DEFAULT_MAIN_LAYOUT)
    }

    // Start auto-persisting layout changes
    startLayoutPersistence(windowId)

    // Clean up stale child window entries from previous sessions
    if (isMain) {
      const windows = getWindows()
      for (const w of windows) {
        if (w.id !== 'main') {
          unregisterWindow(w.id)
          removeLayout(w.id)
        }
      }
    }

    // Child windows: close when main window closes
    const unsubMessage = !isMain ? onMessage((msg) => {
      if (msg.type === 'window-closed' && msg.windowId === 'main') {
        closeWindow()
      }
    }) : undefined

    // Handle this window closing
    const unsubClose = onWindowClose(() => {
      stopLayoutPersistence()
      unregisterWindow(windowId)
      if (!isMain) {
        removeLayout(windowId)
      }
      broadcast({ type: 'window-closed', windowId })
      closeChannel()
      closeWindow()
    })

    return () => {
      unsubMessage?.()
      unsubClose()
      stopLayoutPersistence()
    }
  }, [])

  if (!isMain) return <NewWindow />
  return <Canvas />
}

export default App
