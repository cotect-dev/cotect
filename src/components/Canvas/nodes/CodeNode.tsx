import { memo, useEffect, useRef } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { EditorView, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { oneDark } from '@codemirror/theme-one-dark'
import { useCanvasStore } from '@/store'
import type { CodeNode } from '@/types/nodes'

function getLanguageExt(filePath: string) {
  if (/\.(tsx?)$/.test(filePath)) return javascript({ typescript: true, jsx: true })
  if (/\.(jsx?)$/.test(filePath)) return javascript({ jsx: true })
  if (/\.json$/.test(filePath)) return json()
  if (/\.css$/.test(filePath)) return css()
  return javascript({ typescript: true })
}

export default memo(function CodeNode({ id, data }: NodeProps<CodeNode>) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const focusedNodeId = useCanvasStore((s) => s.focusedNodeId)
  const focused = focusedNodeId === id

  useEffect(() => {
    if (!editorRef.current) return

    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    const state = EditorState.create({
      doc: data.code,
      extensions: [
        EditorState.readOnly.of(true),
        lineNumbers({
          formatNumber: (n) => String(n + data.startLine - 1),
        }),
        highlightActiveLine(),
        getLanguageExt(data.filePath),
        oneDark,
        EditorView.lineWrapping,
        EditorView.theme({
          '&': {
            fontSize: '12px',
          },
          '.cm-scroller': {
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            overflow: 'visible !important',
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
        }),
      ],
    })

    viewRef.current = new EditorView({
      state,
      parent: editorRef.current,
    })

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
    }
  }, [data.code, data.filePath, data.startLine])

  const lineCount = data.endLine - data.startLine + 1
  const fileName = data.filePath.split('/').pop() || data.filePath

  return (
    <div
      className={`bg-background/95 backdrop-blur border rounded-lg min-w-[280px] transition-all duration-150 ${focused ? 'ring-2 ring-primary/60 border-primary/40' : 'border-border'}`}
      style={{ maxWidth: '50vw' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50 bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-foreground truncate">
            {data.label}()
          </span>
          <span className="text-[10px] text-muted-foreground truncate">
            {fileName}
          </span>
        </div>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono shrink-0">
          {lineCount}L
        </span>
      </div>

      {/* Editor */}
      <div ref={editorRef} className="nodrag nowheel" />

      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <Handle type="target" position={Position.Top} className="opacity-0" />
    </div>
  )
})
