import { useEffect, type RefObject } from 'react'
import { useCanvasStore } from '@/store'
import { getPlatform } from '@/services/platform'

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

      // Swallow Tab so the browser doesn't steal focus from the canvas.
      // The focus guard above already lets Tab pass through inputs, textareas,
      // contenteditable elements and the CodeMirror editor, so this only
      // applies while the canvas itself is focused.
      if (key === 'tab') {
        e.preventDefault()
        return
      }

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
          void store.navigateRight()
          break
        case 'e': {
          const focusedId = store.focusedNodeId
          if (!focusedId) break

          // If the focused node is a file, target the CodeMirror editor in the
          // preview column (the file content is shown to the right without
          // navigating into it). Otherwise target the focused node itself.
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
          break
        }
        case 'h':
          e.preventDefault()
          store.toggleHideNode()
          break
        case 'f': {
          // Open the focused node's folder in the system file manager
          const focusedId = store.focusedNodeId
          if (!focusedId) break
          const focusedNode = store.nodes.find((n) => n.id === focusedId)
          if (!focusedNode) break
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
