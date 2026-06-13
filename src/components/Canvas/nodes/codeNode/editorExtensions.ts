import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
  rectangularSelection,
  crosshairCursor,
} from '@codemirror/view'
import { EditorState, EditorSelection, type Extension, type StateCommand } from '@codemirror/state'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  deleteLine,
  toggleComment,
  simplifySelection,
} from '@codemirror/commands'
import { highlightSelectionMatches, search, searchKeymap, gotoLine } from '@codemirror/search'
import {
  closeBrackets,
  closeBracketsKeymap,
  autocompletion,
  acceptCompletion,
} from '@codemirror/autocomplete'
import { indentOnInput, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language'
import { indentationMarkers } from '@replit/codemirror-indentation-markers'
import { vscodeDark } from '../cmThemeVSCode'
import { getLanguageExt } from '@/components/Canvas/nodes/cmLanguages'
import { rainbowBrackets, commentHighlightField, commentHighlightTheme } from '../cmPlugins'
import { codeEditorTheme } from './editorTheme'
import { importClickExtension, type InlineImportMap } from './importClick'
import type { ImportRefItem } from '@/types/nodes'

export interface EditorExtensionOptions {
  filePath: string
  /** Document line numbers are offset so a sliced node shows file-absolute numbers. */
  startLine: number
  /** Pre-wrapped (compartment.of) merge + line-wrap + read-only extensions, owned
   *  by the caller so they can be reconfigured without rebuilding the editor. */
  mergeExt: Extension
  wrapExt: Extension
  readOnlyExt: Extension
  onSave: () => void
  onDocChanged: () => void
  onFocusChange: (hasFocus: boolean) => void
  onGeometryChange: () => void
  getInlineImports: () => InlineImportMap | null
  onOpenImport: (item: ImportRefItem) => void
}

/** VS Code's Ctrl+Shift+Enter — CM only ships the below-variant. */
const insertBlankLineAbove: StateCommand = ({ state, dispatch }) => {
  const changes = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from)
    const indent = /^\s*/.exec(line.text)?.[0] ?? ''
    return {
      changes: { from: line.from, insert: `${indent}\n` },
      range: EditorSelection.cursor(line.from + indent.length),
    }
  })
  dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'input' }))
  return true
}

/** Builds the full extension list for a CodeNode editor view. Static editor
 *  config (syntax, gutters, diff highlighting, keymap, theme) lives here;
 *  document content and stateful compartments are supplied by the caller. */
export function buildEditorExtensions(opts: EditorExtensionOptions): Extension[] {
  const langExt = getLanguageExt(opts.filePath)
  return [
    lineNumbers({
      formatNumber: (n) => String(n + opts.startLine - 1),
    }),
    highlightActiveLine(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightSelectionMatches(),
    search({ top: true }),
    EditorState.allowMultipleSelections.of(true),
    ...(langExt ? [langExt] : []),
    indentationMarkers({
      highlightActiveBlock: true,
      hideFirstIndent: false,
      thickness: 1,
      colors: {
        light: 'rgba(255,255,255,0.08)',
        dark: 'rgba(255,255,255,0.08)',
        activeLight: 'rgba(255,255,255,0.16)',
        activeDark: 'rgba(255,255,255,0.16)',
      },
    }),
    rainbowBrackets,
    importClickExtension(opts.getInlineImports, opts.onOpenImport),
    // Always present but inert until setCommentRanges fires, so a review
    // session that activates after the editor mounts still highlights.
    commentHighlightField,
    commentHighlightTheme,
    vscodeDark,
    opts.readOnlyExt,
    opts.mergeExt,
    opts.wrapExt,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) opts.onDocChanged()
      if (update.focusChanged) opts.onFocusChange(update.view.hasFocus)
      if (update.geometryChanged) opts.onGeometryChange()
    }),
    keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          opts.onSave()
          return true
        },
      },
      // Before searchKeymap so Mod-g means goto-line (VS Code), not find-next;
      // F3/Shift-F3 still cover find navigation.
      { key: 'Mod-g', run: gotoLine },
      { key: 'Mod-Shift-Enter', run: insertBlankLineAbove },
      // searchKeymap before the blur-Escape: closeSearchPanel returns false when
      // no panel is open, falling through to the canvas blur below.
      ...searchKeymap,
      {
        key: 'Escape',
        run: (view) => {
          if (simplifySelection(view)) return true
          view.contentDOM.blur()
          const container = document.querySelector('[data-canvas-container]') as HTMLElement | null
          container?.focus()
          return true
        },
      },
      { key: 'Mod-Shift-k', run: deleteLine },
      { key: 'Mod-/', run: toggleComment },
      { key: 'Tab', run: acceptCompletion },
      indentWithTab,
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
    ]),
    codeEditorTheme,
  ]
}
