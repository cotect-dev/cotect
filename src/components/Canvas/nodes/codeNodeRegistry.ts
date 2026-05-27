import type { EditorView } from '@codemirror/view'

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
