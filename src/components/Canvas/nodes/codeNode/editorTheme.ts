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
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    overflowY: 'auto',
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
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
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
  '&.cm-focused': {
    outline: 'none',
  },
})
