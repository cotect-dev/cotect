import type { EditorView } from '@codemirror/view'

/**
 * Global registry of mounted CodeMirror EditorViews. Kept so that when the
 * canvas viewport moves we can call requestMeasure() on each editor; this is
 * a no-op when CodeMirror is managing its own scrolling, but harmless and
 * useful if a consumer ever needs to force a re-measure.
 */
const editorViews = new Set<EditorView>()

export function registerEditorView(view: EditorView): void {
  editorViews.add(view)
}

export function unregisterEditorView(view: EditorView): void {
  editorViews.delete(view)
}

export function notifyCanvasScrolled(): void {
  for (const view of editorViews) {
    view.requestMeasure()
  }
}
