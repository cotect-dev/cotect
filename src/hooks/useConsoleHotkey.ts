import { useEffect } from 'react'
import { useLayoutStore, getEffectivePosition } from '@/store/layout'
import { getPlatform } from '@/services/platform'
import { DEV } from '@/lib/env'
import { defineBinding } from '@/lib/keybindings'

// F12 toggles regardless of modifier state (the original `e.key !== 'F12'`
// check matched any modifier combo); use a custom matcher rather than the
// stricter `matchChord` helper so behavior is preserved exactly.
const TOGGLE_CONSOLE = defineBinding({
  id: 'dev.console.toggle',
  label: 'Toggle Console',
  scope: 'global',
  group: 'Dev',
  chord: 'F12',
  matches: (e) => e.key === 'F12',
})

export function useConsoleHotkey() {
  useEffect(() => {
    if (!DEV) return
    const onKey = (e: KeyboardEvent) => {
      if (!TOGGLE_CONSOLE.matches(e)) return
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
