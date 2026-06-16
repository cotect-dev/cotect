import { EditorView } from '@codemirror/view'
import { CODE_NODE_HEIGHT_RESERVED } from './constants'

/** VS Code-flavoured layout/diff theme for the CodeNode editor. Syntax colours
 *  come from `vscodeDark`; this owns sizing, scrollbars, gutters, the cursor
 *  blink, and the merge-view added/deleted line tints. */
export const codeEditorTheme = EditorView.theme({
  '&': {
    fontSize: '12px',
    maxHeight: `calc(100vh - ${CODE_NODE_HEIGHT_RESERVED}px)`,
  },
  '.cm-scroller': {
    backgroundColor: 'var(--color-background)',
    backfaceVisibility: 'hidden',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    // Cap the height on the scroll container itself, not just on `&`
    // (.cm-editor). The scroller inherits `height: 100%` from CodeMirror's base
    // theme, which only resolves the viewport cap when its parent's height is
    // definite. Tauri's WebView is WebKitGTK on Linux (vs Chromium/WKWebView
    // elsewhere), and there `height: 100%` against the max-height-only editor
    // stays indefinite, so the editor never caps and grows to the full file
    // height — the node then scrolls by panning the canvas, dragging the header
    // along with it. Owning max-height + overflow on the same element makes the
    // internal scroll reliable on every WebView.
    maxHeight: `calc(100vh - ${CODE_NODE_HEIGHT_RESERVED}px)`,
    overflowY: 'auto',
    overflowAnchor: 'none',
    overscrollBehavior: 'contain',
    scrollbarWidth: 'none',
    '&::-webkit-scrollbar': { display: 'none' },
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: '1px solid rgba(255,255,255,0.06)',
  },
  '.cm-content': {
    padding: '4px 0',
    paddingRight: '26px',
    lineHeight: '18px',
  },
  '.cm-cursor': {
    borderLeftColor: '#aeafad',
    borderLeftWidth: '2px',
    animation: 'cm-blink-smooth 1s ease-in-out infinite',
  },
  '@keyframes cm-blink-smooth': {
    '0%, 100%': { opacity: '1' },
    '50%': { opacity: '0' },
  },
  '&.cm-merge-a .cm-changedText, &.cm-merge-b .cm-changedText, .cm-deletedChunk .cm-deletedText, &.cm-merge-b .cm-deletedText':
    {
      background: 'none',
    },
  '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': {
    backgroundColor: 'rgba(220, 60, 50, 0.22)',
  },
  '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': {
    backgroundColor: 'rgba(80, 200, 100, 0.22)',
  },
  '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': {
    background: 'transparent',
  },
  '&.cm-merge-b .cm-changedLineGutter': {
    background: 'transparent',
  },
  '.cm-cotectDeletionLine': {
    padding: 0,
  },
  '.cm-deletedChunk .cm-deletedLine': {
    opacity: 0.8,
  },
  '.cm-cotectDeletionLines': {
    display: 'flex',
    flexDirection: 'column',
  },
  '.cm-cotectDeletionLineRow': {
    height: '18px',
    lineHeight: '18px',
    color: '#ef4444',
    fontWeight: '700',
    textAlign: 'right',
    paddingRight: '4px',
  },
  '.cm-cotectChangedGutter': {
    color: '#73c48d',
  },
  '.cm-panels': {
    backgroundColor: '#252526',
    color: '#cccccc',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  '.cm-panels.cm-panels-bottom': {
    borderTop: '1px solid rgba(255,255,255,0.06)',
    borderBottom: 'none',
  },
  '.cm-panel.cm-search, .cm-panel.cm-gotoLine': {
    fontSize: '11px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    padding: '4px 6px',
  },
  '.cm-panel input, .cm-panel button, .cm-panel label': {
    fontSize: '11px',
  },
  '.cm-textfield': {
    backgroundColor: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '3px',
    color: '#cccccc',
  },
  '.cm-button': {
    backgroundColor: 'rgba(255,255,255,0.06)',
    backgroundImage: 'none',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '3px',
    color: '#cccccc',
    cursor: 'pointer',
  },
  '.cm-button:active': {
    backgroundImage: 'none',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  '.cm-panel.cm-search [name=close], .cm-panel.cm-gotoLine [name=close]': {
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
  },
  '&.cm-focused': {
    outline: 'none',
  },
})

/** Compartment payload for the line-wrap toggle; off leaves CodeMirror's
 *  base `white-space: pre` so long lines scroll horizontally. */
export const lineWrapExtension = [
  EditorView.lineWrapping,
  EditorView.theme({ '.cm-content': { wordBreak: 'break-all' } }),
]
