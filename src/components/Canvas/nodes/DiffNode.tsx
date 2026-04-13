import { memo, useEffect, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { EditorView, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { unifiedMergeView } from '@codemirror/merge'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { oneDark } from '@codemirror/theme-one-dark'
import { getPlatform } from '@/services/platform'
import type { DiffNode as DiffNodeType } from '@/types/nodes'
import { getNodeFlags } from './nodeUtils'
import { useCanvasStore } from '@/store/canvas'
import { useGitStore } from '@/store/git'

const CODE_NODE_HEIGHT_RESERVED = 120

function getLanguageExt(filePath: string) {
  if (/\.(tsx?)$/.test(filePath)) return javascript({ typescript: true, jsx: true })
  if (/\.(jsx?)$/.test(filePath)) return javascript({ jsx: true })
  if (/\.json$/.test(filePath)) return json()
  if (/\.css$/.test(filePath)) return css()
  return javascript({ typescript: true })
}

function toRepoRelative(absPath: string, repoPath: string): string {
  if (!repoPath) return absPath
  if (absPath.startsWith(repoPath + '/')) return absPath.slice(repoPath.length + 1)
  return absPath
}

export default memo(function DiffNode({ data }: NodeProps<DiffNodeType>) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const flags = getNodeFlags(data)
  const storeWidth = useCanvasStore((s) => s.codeNodeWidth)
  const repoPath = useGitStore((s) => s.repoPath)
  const loadHeadContent = useGitStore((s) => s.loadHeadContent)
  const [placeholder, setPlaceholder] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function setup() {
      if (!editorRef.current) return

      let working: string
      try {
        working = await getPlatform().fs.readFile(data.filePath)
      } catch {
        if (!cancelled) setPlaceholder('diff unavailable — file unreadable')
        return
      }

      let head: string
      if (data.isNewFile) {
        head = ''
      } else {
        const repoRel = toRepoRelative(data.filePath, repoPath)
        const loaded = await loadHeadContent(repoRel)
        if (loaded === null) {
          if (!cancelled) setPlaceholder('diff unavailable — binary file')
          return
        }
        head = loaded
      }

      if (cancelled) return
      setPlaceholder(null)

      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }

      const state = EditorState.create({
        doc: working,
        extensions: [
          lineNumbers(),
          unifiedMergeView({ original: head }),
          getLanguageExt(data.filePath),
          oneDark,
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          EditorView.theme({
            '&': {
              fontSize: '12px',
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
            '&.cm-focused': { outline: 'none' },
          }),
        ],
      })

      viewRef.current = new EditorView({ state, parent: editorRef.current })
    }

    void setup()
    return () => {
      cancelled = true
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
    }
  }, [data.filePath, data.isNewFile, repoPath, loadHeadContent])

  return (
    <div
      className={`relative pointer-events-auto bg-background border border-l-0 rounded-r-lg nodrag nopan ${flags.isFocused ? 'outline outline-2 outline-primary/60 border-primary/40' : 'border-border'} ${flags.isHidden ? 'opacity-30' : ''}`}
      style={{ width: storeWidth }}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50 bg-muted/30">
        <span className="text-xs font-medium text-foreground truncate">
          diff: {data.label}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-800/40 text-yellow-400 font-mono">
          {data.isNewFile ? 'new' : 'modified'}
        </span>
      </div>
      {placeholder ? (
        <div className="p-4 text-xs text-muted-foreground font-mono">{placeholder}</div>
      ) : (
        <div ref={editorRef} className="nowheel" />
      )}
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <Handle type="target" position={Position.Top} className="opacity-0" />
    </div>
  )
})
