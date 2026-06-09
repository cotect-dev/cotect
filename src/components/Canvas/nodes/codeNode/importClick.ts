import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view'
import type { ImportRefItem } from '@/types/nodes'

export type InlineImportMap = Map<number, ImportRefItem[]>

export function resolveImportAtLine(
  imports: InlineImportMap | null,
  line: number,
): ImportRefItem | null {
  return imports?.get(line)?.[0] ?? null
}

export const setHoverLine = StateEffect.define<number | null>()

export const hoverLineField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setHoverLine)) value = e.value
    return value
  },
})

const hoverDecorations = EditorView.decorations.compute([hoverLineField], (state) => {
  const line = state.field(hoverLineField)
  if (line === null || line < 1 || line > state.doc.lines) return Decoration.none
  return Decoration.set([
    Decoration.line({ class: 'cm-import-link' }).range(state.doc.line(line).from),
  ]) as DecorationSet
})

const hoverTheme = EditorView.baseTheme({
  '.cm-import-link, .cm-import-link *': {
    textDecoration: 'underline',
    textDecorationColor: 'rgba(96, 165, 250, 0.8)',
    cursor: 'pointer',
  },
})

function isMod(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.metaKey || e.ctrlKey
}

// Modifier release and window blur must clear a stuck underline even
// without further mouse movement.
const modifierWatcher = ViewPlugin.define((view) => {
  const clear = () => {
    if (view.state.field(hoverLineField) !== null) {
      view.dispatch({ effects: setHoverLine.of(null) })
    }
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Meta' || e.key === 'Control') clear()
  }
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', clear)
  return {
    destroy() {
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clear)
    },
  }
})

/** Cmd/Ctrl+click on an import line navigates to the imported file; while the
 *  modifier is held the hovered import line is underlined (VS Code style). */
export function importClickExtension(
  getImports: () => InlineImportMap | null,
  onNavigate: (item: ImportRefItem) => void,
): Extension {
  const lineAtCoords = (view: EditorView, e: MouseEvent): number | null => {
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
    return pos === null ? null : view.state.doc.lineAt(pos).number
  }

  const applyHover = (view: EditorView, line: number | null) => {
    const importLine = line !== null && resolveImportAtLine(getImports(), line) ? line : null
    if (view.state.field(hoverLineField) !== importLine) {
      view.dispatch({ effects: setHoverLine.of(importLine) })
    }
  }

  const domHandlers = EditorView.domEventHandlers({
    mousedown: (e, view) => {
      if (e.button !== 0 || !isMod(e)) return false
      const line = lineAtCoords(view, e)
      const item = line === null ? null : resolveImportAtLine(getImports(), line)
      if (!item) return false
      e.preventDefault()
      onNavigate(item)
      return true
    },
    mousemove: (e, view) => {
      applyHover(view, isMod(e) ? lineAtCoords(view, e) : null)
      return false
    },
    mouseleave: (_e, view) => {
      applyHover(view, null)
      return false
    },
  })

  return [hoverLineField, hoverDecorations, hoverTheme, domHandlers, modifierWatcher]
}
