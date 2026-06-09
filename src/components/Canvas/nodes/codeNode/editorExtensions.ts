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
import { EditorState, type Extension } from '@codemirror/state'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  copyLineDown,
  deleteLine,
  toggleComment,
} from '@codemirror/commands'
import { highlightSelectionMatches } from '@codemirror/search'
import {
  closeBrackets,
  closeBracketsKeymap,
  autocompletion,
  acceptCompletion,
} from '@codemirror/autocomplete'
import { indentOnInput, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language'
import { indentationMarkers } from '@replit/codemirror-indentation-markers'
import { vscodeDark } from '../cmThemeVSCode'
import { getLanguageExt } from '../cmLanguages'
import { rainbowBrackets, commentHighlightField, commentHighlightTheme } from '../cmPlugins'
import { codeEditorTheme } from './editorTheme'

export interface EditorExtensionOptions {
  filePath: string
  /** Document line numbers are offset so a sliced node shows file-absolute numbers. */
  startLine: number
  isReadOnly: boolean
  /** Pre-wrapped (compartment.of) merge + line-wrap extensions, owned by the caller
   *  so they can be reconfigured without rebuilding the editor. */
  mergeExt: Extension
  wrapExt: Extension
  onSave: () => void
  onDocChanged: () => void
  onFocusChange: (hasFocus: boolean) => void
  onGeometryChange: () => void
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
    // Always present but inert until setCommentRanges fires, so a review
    // session that activates after the editor mounts still highlights.
    commentHighlightField,
    commentHighlightTheme,
    vscodeDark,
    ...(opts.isReadOnly ? [EditorState.readOnly.of(true)] : []),
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
      {
        key: 'Escape',
        run: (view) => {
          view.contentDOM.blur()
          const container = document.querySelector('[data-canvas-container]') as HTMLElement | null
          container?.focus()
          return true
        },
      },
      { key: 'Mod-d', run: copyLineDown },
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
