import { useEffect, type RefObject } from 'react'
import { useCanvasStore, useViewStore } from '@/store'
import { getPlatform } from '@/services/platform'
import { defineBinding } from '@/lib/keybindings'

const FOCUS_GUARD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

// Canvas navigation chords: each fires regardless of modifier state (the
// original implementation matched against `e.key.toLowerCase()` without any
// modifier check), so we use custom `matches` closures rather than the
// stricter `matchChord` helper to preserve exact behavior.
const keyIs = (key: string) => (e: KeyboardEvent) => e.key.toLowerCase() === key

const FOCUS_UP_W = defineBinding({
  id: 'canvas.focus.up.w', label: 'Focus up', scope: 'canvas', group: 'Canvas',
  chord: 'W', matches: keyIs('w'),
})
const FOCUS_UP_ARROW = defineBinding({
  id: 'canvas.focus.up.arrow', label: 'Focus up', scope: 'canvas', group: 'Canvas',
  chord: 'ArrowUp', matches: keyIs('arrowup'),
})
const FOCUS_DOWN_S = defineBinding({
  id: 'canvas.focus.down.s', label: 'Focus down', scope: 'canvas', group: 'Canvas',
  chord: 'S', matches: keyIs('s'),
})
const FOCUS_DOWN_ARROW = defineBinding({
  id: 'canvas.focus.down.arrow', label: 'Focus down', scope: 'canvas', group: 'Canvas',
  chord: 'ArrowDown', matches: keyIs('arrowdown'),
})
const NAV_LEFT_A = defineBinding({
  id: 'canvas.nav.left.a', label: 'Navigate to parent column', scope: 'canvas', group: 'Canvas',
  chord: 'A', matches: keyIs('a'),
})
const NAV_LEFT_ARROW = defineBinding({
  id: 'canvas.nav.left.arrow', label: 'Navigate to parent column', scope: 'canvas', group: 'Canvas',
  chord: 'ArrowLeft', matches: keyIs('arrowleft'),
})
const NAV_RIGHT_D = defineBinding({
  id: 'canvas.nav.right.d', label: 'Enter focused node', scope: 'canvas', group: 'Canvas',
  chord: 'D', matches: keyIs('d'),
})
const NAV_RIGHT_ARROW = defineBinding({
  id: 'canvas.nav.right.arrow', label: 'Enter focused node', scope: 'canvas', group: 'Canvas',
  chord: 'ArrowRight', matches: keyIs('arrowright'),
})
const FOCUS_EDITOR = defineBinding({
  id: 'canvas.focus.editor', label: 'Focus code editor', scope: 'canvas', group: 'Canvas',
  chord: 'E', matches: keyIs('e'),
})
const TOGGLE_HIDE = defineBinding({
  id: 'canvas.toggleHide', label: 'Toggle hide node', scope: 'canvas', group: 'Canvas',
  chord: 'H', matches: keyIs('h'),
})
const SHOW_IN_FOLDER = defineBinding({
  id: 'canvas.showInFolder', label: 'Show in folder', scope: 'canvas', group: 'Canvas',
  chord: 'F', matches: keyIs('f'),
})
const SWALLOW_TAB = defineBinding({
  id: 'canvas.swallowTab', label: 'Swallow Tab (keep canvas focus)', scope: 'canvas', group: 'Canvas',
  chord: 'Tab', matches: keyIs('tab'),
})

/**
 * W/S or Arrow Up/Down: move focus vertically within a column.
 * A/D or Arrow Left/Right: navigate columns (left = parent, right = enter).
 * Inactive when an input/textarea/contenteditable/CodeMirror editor is focused.
 */
export function useCanvasKeyboard(containerRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    function handleKeyDown(e: KeyboardEvent) {
      const active = document.activeElement as HTMLElement | null
      if (active && (
        FOCUS_GUARD_TAGS.has(active.tagName) ||
        active.isContentEditable ||
        active.closest('.cm-editor')
      )) {
        return
      }

      const store = useCanvasStore.getState()

      // Swallow Tab so the browser doesn't steal focus from the canvas.
      // (The focus guard above lets Tab pass through inputs/editors.)
      if (SWALLOW_TAB.matches(e)) {
        e.preventDefault()
        return
      }

      if (FOCUS_UP_W.matches(e) || FOCUS_UP_ARROW.matches(e)) {
        e.preventDefault()
        store.moveFocus('up')
        return
      }
      if (FOCUS_DOWN_S.matches(e) || FOCUS_DOWN_ARROW.matches(e)) {
        e.preventDefault()
        store.moveFocus('down')
        return
      }
      if (NAV_LEFT_A.matches(e) || NAV_LEFT_ARROW.matches(e)) {
        e.preventDefault()
        store.navigateLeft()
        return
      }
      if (NAV_RIGHT_D.matches(e) || NAV_RIGHT_ARROW.matches(e)) {
        e.preventDefault()
        void store.navigateRight()
        return
      }
      if (FOCUS_EDITOR.matches(e)) {
        const focusedId = store.focusedNodeId
        if (!focusedId) return

        // For file nodes, focus the CodeMirror editor in the preview
        // column rather than the file node itself.
        const focusedNode = store.nodes.find((n) => n.id === focusedId)
        let cmContent: HTMLElement | null = null

        if (focusedNode?.type === 'file') {
          const previewCol = store.columns[store.currentColumnIndex + 1]
          if (previewCol?.kind === 'file' && previewCol.nodes[0]) {
            const previewEl = container?.querySelector(
              `[data-id="${CSS.escape(previewCol.nodes[0].id)}"]`,
            )
            cmContent = previewEl?.querySelector('.cm-content') as HTMLElement | null
          }
        } else {
          const nodeEl = container?.querySelector(`[data-id="${CSS.escape(focusedId)}"]`)
          cmContent = nodeEl?.querySelector('.cm-content') as HTMLElement | null
        }

        if (cmContent) {
          e.preventDefault()
          cmContent.focus()
        }
        return
      }
      if (TOGGLE_HIDE.matches(e)) {
        e.preventDefault()
        store.toggleHideNode()
        return
      }
      if (SHOW_IN_FOLDER.matches(e)) {
        const focusedId = store.focusedNodeId
        if (!focusedId) return
        const focusedNode = store.nodes.find((n) => n.id === focusedId)
        if (!focusedNode) return
        const nodePath =
          focusedNode.type === 'folder' || focusedNode.type === 'file'
            ? focusedNode.data.path
            : focusedNode.data.filePath
        if (nodePath) {
          e.preventDefault()
          getPlatform().fs.showInFolder(nodePath).catch((err) => {
            console.error('Failed to open in folder:', err)
          })
        }
        return
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    if (!container.getAttribute('tabindex')) {
      container.setAttribute('tabindex', '0')
    }

    // Global listener: when WASD/arrows are pressed and no input is focused,
    // reclaim focus for the canvas and execute the navigation action. This
    // makes the canvas "sticky" — the user doesn't have to manually click it
    // to resume keyboard navigation after interacting with other UI elements.
    function handleGlobalKeyDown(e: KeyboardEvent) {
      // Only reclaim when the files view is active.
      if (useViewStore.getState().viewMode !== 'files') return

      const active = document.activeElement as HTMLElement | null
      // If focus is already inside the canvas container, the local listener
      // will handle it — no need to duplicate.
      if (active && container.contains(active)) return

      // Don't steal from inputs, textareas, selects, contenteditable, or editors.
      if (active && (
        FOCUS_GUARD_TAGS.has(active.tagName) ||
        active.isContentEditable ||
        active.closest('.cm-editor')
      )) {
        return
      }

      // Check if this is a canvas navigation key.
      const isNavKey =
        FOCUS_UP_W.matches(e) || FOCUS_UP_ARROW.matches(e) ||
        FOCUS_DOWN_S.matches(e) || FOCUS_DOWN_ARROW.matches(e) ||
        NAV_LEFT_A.matches(e) || NAV_LEFT_ARROW.matches(e) ||
        NAV_RIGHT_D.matches(e) || NAV_RIGHT_ARROW.matches(e)

      if (!isNavKey) return

      // Reclaim focus for the canvas.
      e.preventDefault()
      container.focus()

      // Execute the action directly (focus event won't re-trigger keydown).
      const store = useCanvasStore.getState()
      if (FOCUS_UP_W.matches(e) || FOCUS_UP_ARROW.matches(e)) {
        store.moveFocus('up')
      } else if (FOCUS_DOWN_S.matches(e) || FOCUS_DOWN_ARROW.matches(e)) {
        store.moveFocus('down')
      } else if (NAV_LEFT_A.matches(e) || NAV_LEFT_ARROW.matches(e)) {
        store.navigateLeft()
      } else if (NAV_RIGHT_D.matches(e) || NAV_RIGHT_ARROW.matches(e)) {
        void store.navigateRight()
      }
    }

    document.addEventListener('keydown', handleGlobalKeyDown)

    return () => {
      container.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keydown', handleGlobalKeyDown)
    }
  }, [containerRef])
}
