import { useEffect, type RefObject } from 'react'
import { useCanvasStore, useViewStore } from '@/store'
import { getPlatform } from '@/services/platform'
import { defineBinding } from '@/lib/keybindings'
import { isDemoMode } from '@/lib/demoMode'

const FOCUS_GUARD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

const keyIs = (key: string) => (e: KeyboardEvent) => e.key.toLowerCase() === key

const FOCUS_UP_W = defineBinding({
  id: 'canvas.focus.up.w',
  label: 'Focus up',
  scope: 'canvas',
  group: 'Canvas',
  chord: 'W',
  matches: keyIs('w'),
})
const FOCUS_UP_ARROW = defineBinding({
  id: 'canvas.focus.up.arrow',
  label: 'Focus up',
  scope: 'canvas',
  group: 'Canvas',
  chord: 'ArrowUp',
  matches: keyIs('arrowup'),
})
const FOCUS_DOWN_S = defineBinding({
  id: 'canvas.focus.down.s',
  label: 'Focus down',
  scope: 'canvas',
  group: 'Canvas',
  chord: 'S',
  matches: keyIs('s'),
})
const FOCUS_DOWN_ARROW = defineBinding({
  id: 'canvas.focus.down.arrow',
  label: 'Focus down',
  scope: 'canvas',
  group: 'Canvas',
  chord: 'ArrowDown',
  matches: keyIs('arrowdown'),
})
const NAV_LEFT_A = defineBinding({
  id: 'canvas.nav.left.a',
  label: 'Navigate to parent column',
  scope: 'canvas',
  group: 'Canvas',
  chord: 'A',
  matches: keyIs('a'),
})
const NAV_LEFT_ARROW = defineBinding({
  id: 'canvas.nav.left.arrow',
  label: 'Navigate to parent column',
  scope: 'canvas',
  group: 'Canvas',
  chord: 'ArrowLeft',
  matches: keyIs('arrowleft'),
})
const NAV_RIGHT_D = defineBinding({
  id: 'canvas.nav.right.d',
  label: 'Enter focused node',
  scope: 'canvas',
  group: 'Canvas',
  chord: 'D',
  matches: keyIs('d'),
})
const NAV_RIGHT_ARROW = defineBinding({
  id: 'canvas.nav.right.arrow',
  label: 'Enter focused node',
  scope: 'canvas',
  group: 'Canvas',
  chord: 'ArrowRight',
  matches: keyIs('arrowright'),
})
const FOCUS_EDITOR = defineBinding({
  id: 'canvas.focus.editor',
  label: 'Focus code editor',
  scope: 'canvas',
  group: 'Canvas',
  chord: 'E',
  matches: keyIs('e'),
})
const TOGGLE_HIDE = defineBinding({
  id: 'canvas.toggleHide',
  label: 'Toggle hide node',
  scope: 'canvas',
  group: 'Canvas',
  chord: 'H',
  matches: keyIs('h'),
})
const NAV_BACK = defineBinding({
  id: 'canvas.nav.back',
  label: 'Navigate back',
  scope: 'canvas',
  group: 'Canvas',
  chord: 'Q',
  matches: keyIs('q'),
})
const SHOW_IN_FOLDER = defineBinding({
  id: 'canvas.showInFolder',
  label: 'Show in folder',
  scope: 'canvas',
  group: 'Canvas',
  chord: 'F',
  matches: keyIs('f'),
})
const SWALLOW_TAB = defineBinding({
  id: 'canvas.swallowTab',
  label: 'Swallow Tab (keep canvas focus)',
  scope: 'canvas',
  group: 'Canvas',
  chord: 'Tab',
  matches: keyIs('tab'),
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
      if (
        active &&
        (FOCUS_GUARD_TAGS.has(active.tagName) ||
          active.isContentEditable ||
          active.closest('.cm-editor'))
      ) {
        return
      }

      const store = useCanvasStore.getState()

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
      if (NAV_BACK.matches(e)) {
        e.preventDefault()
        void store.navigateBack()
        return
      }
      if (FOCUS_EDITOR.matches(e)) {
        const focusedId = store.focusedNodeId
        if (!focusedId) return

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
        const nodePath = (
          focusedNode.type === 'folder' || focusedNode.type === 'file'
            ? focusedNode.data.path
            : focusedNode.data.filePath
        ) as string | undefined
        if (nodePath) {
          e.preventDefault()
          getPlatform()
            .fs.showInFolder(nodePath)
            .catch((err) => {
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

    // Global listener: reclaim focus for the canvas on WASD/arrows so the
    // user doesn't have to click it after interacting with other UI.
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if (isDemoMode()) return
      if (useViewStore.getState().viewMode !== 'files') return

      const active = document.activeElement as HTMLElement | null
      if (active && container?.contains(active)) return

      if (
        active &&
        (FOCUS_GUARD_TAGS.has(active.tagName) ||
          active.isContentEditable ||
          active.closest('.cm-editor'))
      ) {
        return
      }

      const isNavKey =
        FOCUS_UP_W.matches(e) ||
        FOCUS_UP_ARROW.matches(e) ||
        FOCUS_DOWN_S.matches(e) ||
        FOCUS_DOWN_ARROW.matches(e) ||
        NAV_LEFT_A.matches(e) ||
        NAV_LEFT_ARROW.matches(e) ||
        NAV_RIGHT_D.matches(e) ||
        NAV_RIGHT_ARROW.matches(e)

      if (!isNavKey) return

      e.preventDefault()
      container?.focus()

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
