import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { oneDark } from '@codemirror/theme-one-dark'
import { getPlatform } from '@/services/platform'
import type { CodeNode } from '@/types/nodes'
import { getNodeFlags } from './nodeUtils'
import { registerEditorView, unregisterEditorView } from './codeNodeRegistry'
import { useCanvasStore } from '@/store/canvas'

function getLanguageExt(filePath: string) {
  if (/\.(tsx?)$/.test(filePath)) return javascript({ typescript: true, jsx: true })
  if (/\.(jsx?)$/.test(filePath)) return javascript({ jsx: true })
  if (/\.json$/.test(filePath)) return json()
  if (/\.css$/.test(filePath)) return css()
  return javascript({ typescript: true })
}

const MIN_CODE_NODE_WIDTH = 280
/**
 * Vertical space reserved above/below the editor for the top bar and
 * a little breathing room. The editor will grow until it reaches
 * `window.innerHeight - CODE_NODE_HEIGHT_RESERVED`, then scroll internally.
 */
const CODE_NODE_HEIGHT_RESERVED = 120

export default memo(function CodeNode({ data }: NodeProps<CodeNode>) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const resizeRef = useRef<HTMLDivElement>(null)
  const flags = getNodeFlags(data)
  const [editorFocused, setEditorFocused] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const storeWidth = useCanvasStore((s) => s.codeNodeWidth)
  const setCodeNodeWidth = useCanvasStore((s) => s.setCodeNodeWidth)
  const [nodeWidth, setNodeWidth] = useState<number>(storeWidth)

  // Sync from store when it changes externally (e.g. cross-window sync, hydration)
  useEffect(() => {
    setNodeWidth(storeWidth)
  }, [storeWidth])

  /**
   * Start a right-edge resize drag. Uses native document listeners so the
   * drag keeps working even if the pointer leaves the small handle area,
   * and short-circuits ReactFlow's own drag handlers via stopPropagation
   * + preventDefault on the initial mousedown.
   */
  const handleResizeMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = nodeWidth
    const handle = resizeRef.current

    handle?.setAttribute('data-resizing', '')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      ev.preventDefault()
      const next = Math.max(MIN_CODE_NODE_WIDTH, startWidth + (ev.clientX - startX))
      setNodeWidth(next)
    }
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      handle?.removeAttribute('data-resizing')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      const finalWidth = Math.max(MIN_CODE_NODE_WIDTH, startWidth + (ev.clientX - startX))
      setCodeNodeWidth(finalWidth)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [nodeWidth, setCodeNodeWidth])

  const saveToFile = useCallback(async () => {
    const view = viewRef.current
    if (!view) return false
    setSaving(true)
    try {
      const platform = getPlatform()
      const newContent = view.state.doc.toString()
      await platform.fs.writeFile(data.filePath, newContent)
      setDirty(false)
      return true
    } catch (err) {
      console.error('Failed to save:', err)
      return false
    } finally {
      setSaving(false)
    }
  }, [data.filePath])

  useEffect(() => {
    if (!editorRef.current) return

    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    const state = EditorState.create({
      doc: data.code,
      extensions: [
        lineNumbers({
          // CodeMirror passes 1-based line numbers to `formatNumber`, so the
          // first line in the snippet maps to `data.startLine` directly.
          formatNumber: (n) => String(n + data.startLine - 1),
        }),
        highlightActiveLine(),
        getLanguageExt(data.filePath),
        oneDark,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            setDirty(true)
          }
          if (update.focusChanged) {
            setEditorFocused(update.view.hasFocus)
          }
        }),
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              void saveToFile()
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
        ]),
        EditorView.theme({
          '&': {
            fontSize: '12px',
            // Let the editor grow with its content up to the window height,
            // then scroll internally. This is the CodeMirror-idiomatic way
            // to get a "grow-until-cap then scroll" behaviour — see:
            // https://codemirror.net/examples/styling/#overflow-and-scrolling
            maxHeight: `calc(100vh - ${CODE_NODE_HEIGHT_RESERVED}px)`,
          },
          '.cm-scroller': {
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            overflowY: 'auto',
          },
          '.cm-gutters': {
            backgroundColor: 'transparent',
            borderRight: '1px solid rgba(255,255,255,0.06)',
          },
          '.cm-content': {
            padding: '4px 0',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          },
          '&.cm-focused': {
            outline: 'none',
          },
        }),
      ],
    })

    viewRef.current = new EditorView({
      state,
      parent: editorRef.current,
    })
    registerEditorView(viewRef.current)

    return () => {
      if (viewRef.current) {
        unregisterEditorView(viewRef.current)
        viewRef.current.destroy()
        viewRef.current = null
      }
    }
  }, [data.code, data.filePath, data.startLine]) // eslint-disable-line react-hooks/exhaustive-deps

  const lineCount = data.endLine - data.startLine + 1

  return (
    <div
      className={`relative pointer-events-auto bg-background/95 backdrop-blur border rounded-lg nodrag nopan ${flags.isFocused ? 'ring-2 ring-primary/60 border-primary/40' : 'border-border'} ${editorFocused ? 'border-primary/30' : ''} ${flags.isHidden ? 'opacity-30' : ''}`}
      style={{ width: nodeWidth }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50 bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-foreground truncate">
            {data.label}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {dirty && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-800/40 text-yellow-400 font-mono">
              {saving ? 'saving...' : 'modified'}
            </span>
          )}
          {editorFocused && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-mono">
              editing
            </span>
          )}
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
            {lineCount}L
          </span>
        </div>
      </div>

      <div
        ref={editorRef}
        className="nowheel"
      />

      <div
        ref={resizeRef}
        onMouseDown={handleResizeMouseDown}
        className="nodrag nopan group/handle absolute top-0 right-0 bottom-0 w-3 cursor-col-resize
          flex items-center justify-center z-10"
        role="separator"
      >
        <div className="absolute inset-y-0 right-0 w-px
          bg-foreground/10 group-hover/handle:bg-primary/40 group-data-[resizing]/handle:bg-primary/40 transition-colors" />
        <div className="z-10 shrink-0 rounded-lg transition-colors
          bg-background border border-foreground/15
          group-hover/handle:border-primary/40 group-data-[resizing]/handle:border-primary/40
          h-6 w-1.5"
        />
      </div>

      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <Handle type="target" position={Position.Top} className="opacity-0" />
    </div>
  )
})
