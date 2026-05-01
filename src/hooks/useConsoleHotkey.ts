import { useEffect } from 'react'
import { useLayoutStore, getEffectivePosition } from '@/store/layout'
import { getPlatform } from '@/services/platform'
import { DEV } from '@/lib/env'

// F12 toggles the Console panel in the current window. The panel docks into
// the bottom zone (or 'right' as fallback in child windows that don't render
// a bottom zone) and behaves like any other panel — drag, resize, tab.
// DEV-only: in production builds the listener is never attached.
export function useConsoleHotkey() {
  useEffect(() => {
    if (!DEV) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F12') return
      e.preventDefault()
      const { panels, addPanel, removePanel } = useLayoutStore.getState()
      const visible =
        panels.left.some((g) => g.includes('console')) ||
        panels.right.some((g) => g.includes('console')) ||
        panels.bottom.some((g) => g.includes('console'))
      if (visible) {
        removePanel('console')
      } else {
        const isChild = getPlatform().windows.getWindowId() !== 'main'
        addPanel('console', getEffectivePosition('console', isChild))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
