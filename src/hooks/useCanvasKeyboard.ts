import { useEffect, type RefObject } from 'react'
import { useCanvasStore } from '@/store'
import { getPlatform } from '@/services/platform'

const FOCUS_GUARD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

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
      const key = e.key.toLowerCase()

      // Swallow Tab so the browser doesn't steal focus from the canvas.
      // (The focus guard above lets Tab pass through inputs/editors.)
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
          break
        }
        case 'h':
          e.preventDefault()
          store.toggleHideNode()
          break
        case 'f': {
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
    if (!container.getAttribute('tabindex')) {
      container.setAttribute('tabindex', '0')
    }

    return () => {
      container.removeEventListener('keydown', handleKeyDown)
    }
  }, [containerRef])
}
