import { useEffect, type RefObject } from 'react'
import { useCanvasStore } from '@/store'

const FOCUS_GUARD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * Keyboard navigation hook for the canvas.
 * W/S (or Arrow Up/Down) for vertical movement within a column.
 * A/D (or Arrow Left/Right) to navigate between columns (left = parent, right = enter).
 * Only active when no input/textarea/contenteditable is focused.
 */
export function useCanvasKeyboard(containerRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    function handleKeyDown(e: KeyboardEvent) {
      // Focus guard: don't capture when typing in inputs or code editors
      const active = document.activeElement as HTMLElement | null
      if (active && (
        FOCUS_GUARD_TAGS.has(active.tagName) ||
        active.isContentEditable ||
        active.closest('.cm-editor')
      )) {
        return
      }

      const store = useCanvasStore.getState()
      const key = e.key.toLowerCase()

      switch (key) {
        case 'w':
        case 'arrowup':
          e.preventDefault()
          store.moveFocus('up')
          break
        case 's':
        case 'arrowdown':
          e.preventDefault()
          store.moveFocus('down')
          break
        case 'a':
        case 'arrowleft':
          e.preventDefault()
          store.navigateLeft()
          break
        case 'd':
        case 'arrowright':
          e.preventDefault()
          store.navigateRight()
          break
        case 'e': {
          // Focus the CodeMirror editor inside the currently focused code node
          const focusedId = store.focusedNodeId
          if (!focusedId) break
          const nodeEl = container?.querySelector(`[data-id="${CSS.escape(focusedId)}"]`)
          const cmContent = nodeEl?.querySelector('.cm-content') as HTMLElement | null
          if (cmContent) {
            e.preventDefault()
            cmContent.focus()
          }
          break
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    // Make the container focusable so it can receive key events
    if (!container.getAttribute('tabindex')) {
      container.setAttribute('tabindex', '0')
    }

    return () => {
      container.removeEventListener('keydown', handleKeyDown)
    }
  }, [containerRef])
}
