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
import { getNodeFlags } from '.'

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
  const flags = getNodeFlags(data as Record<string, unknown>)
  const [editorFocused, setEditorFocused] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const saveToFile = useCallback(async () => {
    const view = viewRef.current
    if (!view) return false
    setSaving(true)
    try {
      const platform = getPlatform()
      const newCode = view.state.doc.toString()
      const fullContent = await platform.fs.readFile(data.filePath)
      const lines = fullContent.split('\n')
      // startLine/endLine are 0-indexed (from tree-sitter)
      const before = lines.slice(0, data.startLine)
      const after = lines.slice(data.endLine + 1)
      const updatedContent = [...before, ...newCode.split('\n'), ...after].join('\n')
      await platform.fs.writeFile(data.filePath, updatedContent)
      setDirty(false)
      return true
    } catch (err) {
      console.error('Failed to save:', err)
      return false
    } finally {
      setSaving(false)
    }
  }, [data.filePath, data.startLine, data.endLine])

  useEffect(() => {
    if (!editorRef.current) return

    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    const state = EditorState.create({
      doc: data.code,
      extensions: [
        // No readOnly — the editor is always editable
        lineNumbers({
          // startLine is 0-indexed, CodeMirror line numbers are 1-indexed
          formatNumber: (n) => String(n + data.startLine),
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
              saveToFile()
              return true
            },
          },
          {
            // Escape blurs the editor and refocuses the canvas container
            key: 'Escape',
            run: (view) => {
              view.contentDOM.blur()
              // Refocus the canvas container so WASD navigation works
              const container = document.querySelector('[data-canvas-container]') as HTMLElement | null
              container?.focus()
              return true
            },
          },
        ]),
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

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
    }
  }, [data.code, data.filePath, data.startLine]) // eslint-disable-line react-hooks/exhaustive-deps

  const lineCount = data.endLine - data.startLine + 1
  const fileName = data.filePath.split('/').pop() || data.filePath

  return (
    <div
      className={`bg-background/95 backdrop-blur border rounded-lg min-w-[280px] transition-all duration-150 nodrag nopan ${flags.isFocused ? 'ring-2 ring-primary/60 border-primary/40' : 'border-border'} ${editorFocused ? 'border-primary/30' : ''} ${flags.isHidden ? 'opacity-30' : ''}`}
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

      {/* Editor */}
      <div ref={editorRef} className="nowheel" />

      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <Handle type="target" position={Position.Top} className="opacity-0" />
    </div>
  )
})
