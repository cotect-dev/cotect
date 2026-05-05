import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDragHandle } from '@/hooks/useDragHandle'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, dropCursor, highlightSpecialChars, rectangularSelection, crosshairCursor } from '@codemirror/view'
import { EditorState, Compartment, type Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab, copyLineDown, deleteLine, toggleComment } from '@codemirror/commands'
import { highlightSelectionMatches } from '@codemirror/search'
import { closeBrackets, closeBracketsKeymap, autocompletion, acceptCompletion } from '@codemirror/autocomplete'
import { indentOnInput, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { oneDark } from '@codemirror/theme-one-dark'
import { unifiedMergeView } from '@codemirror/merge'
import { getPlatform } from '@/services/platform'
import type { CodeNode } from '@/types/nodes'
import { getNodeFlags, nodeFocusRing } from './nodeUtils'
import { registerEditorView, unregisterEditorView } from './codeNodeRegistry'
import { useCanvasStore } from '@/store/canvas'
import { useGitStore } from '@/store/git'
import { samePath, toRepoRelative } from '@/lib/repoPath'

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

/**
 * Build the set of extensions to load inside the merge-view compartment.
 * Returns an empty array when there is no HEAD content to compare against,
 * so reconfiguring with this cleanly removes the diff highlighting.
 *
 * onChunkAction fires after CodeMirror's default accept/reject transaction
 * has already mutated the editor doc — used by the caller to persist the
 * change back to disk so git picks it up.
 */
function buildMergeExtension(
  head: string | null,
  onChunkAction: (type: 'accept' | 'reject') => void,
): Extension {
  if (head === null) return []
  return unifiedMergeView({
    original: head,
    mergeControls: (type, action) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = type === 'accept' ? '✓ accept' : '✕ reject'
      btn.className =
        'cm-merge-stub-btn text-[10px] font-mono px-1.5 py-0.5 mx-0.5 rounded ' +
        (type === 'accept'
          ? 'bg-green-900/40 text-green-400 hover:bg-green-900/60'
          : 'bg-red-900/40 text-red-400 hover:bg-red-900/60')
      btn.addEventListener('click', (e) => {
        action(e)
        onChunkAction(type)
      })
      return btn
    },
  })
}

export default memo(function CodeNode({ data }: NodeProps<CodeNode>) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const mergeCompartmentRef = useRef<Compartment>(new Compartment())
  const flags = getNodeFlags(data)
  const [editorFocused, setEditorFocused] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const storeWidth = useCanvasStore((s) => s.codeNodeWidth)
  const setCodeNodeWidth = useCanvasStore((s) => s.setCodeNodeWidth)
  const [nodeWidth, setNodeWidth] = useState<number>(storeWidth)

  // Git-aware inline diff: if the current file is dirty, render the editor
  // with a unifiedMergeView extension comparing working tree vs HEAD content.
  const gitStatus = useGitStore((s) => s.status)
  const repoPath = useGitStore((s) => s.repoPath)
  const loadHeadContent = useGitStore((s) => s.loadHeadContent)

  const gitEntry = useMemo(() => {
    if (!gitStatus) return null
    return (
      gitStatus.files.find((f) => samePath(data.filePath, f.path, repoPath)) ?? null
    )
  }, [gitStatus, data.filePath, repoPath])

  const isNewFile = gitEntry?.status === 'A' || gitEntry?.status === 'U'
  // null = no diff needed, string = HEAD content to diff against (empty for new files)
  const [headContent, setHeadContent] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!gitEntry) {
      setHeadContent(null)
      return
    }
    if (isNewFile) {
      setHeadContent('')
      return
    }
    const repoRel = toRepoRelative(data.filePath, repoPath)
    void loadHeadContent(repoRel).then((content) => {
      if (!cancelled) setHeadContent(content)
    })
    return () => {
      cancelled = true
    }
  }, [gitEntry, isNewFile, data.filePath, repoPath, loadHeadContent])

  // Sync from store when it changes externally (e.g. cross-window sync, hydration)
  useEffect(() => {
    setNodeWidth(storeWidth)
  }, [storeWidth])

  // Right-edge resize. `nodeWidth` is snapshotted at drag start so the
  // memoized hook closures see a stable starting point across re-renders.
  const dragStartWidthRef = useRef(0)
  const widthFromDelta = (deltaX: number) =>
    Math.max(MIN_CODE_NODE_WIDTH, dragStartWidthRef.current + deltaX)
  const { handleProps: resizeHandleProps } = useDragHandle({
    cursor: 'col-resize',
    onStart: () => { dragStartWidthRef.current = nodeWidth },
    onMove: (_e, { deltaX }) => setNodeWidth(widthFromDelta(deltaX)),
    onEnd: (_e, { deltaX }) => setCodeNodeWidth(widthFromDelta(deltaX)),
  })
  const resizeRef = resizeHandleProps.ref as React.RefObject<HTMLDivElement | null>

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

  const handleChunkAction = useCallback(
    (type: 'accept' | 'reject') => {
      // CodeMirror already mutated the editor doc in `action(e)` before we get
      // here. Persist the new content so the file watcher → git refresh picks
      // up the change and the merge highlighting reconciles.
      void saveToFile()
      // TODO: hook real git actions here
      // accept → stage the hunk (git add -p)
      // reject → checkout the hunk from HEAD (git checkout -p)
      console.log(`[CodeNode] ${type} chunk for ${data.filePath}`)
    },
    [saveToFile, data.filePath],
  )

  useEffect(() => {
    if (!editorRef.current) return

    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    // Give the merge extension a fresh compartment for each new editor
    // instance — compartments are tied to an EditorState, not reusable across
    // destroyed views.
    mergeCompartmentRef.current = new Compartment()
    const initialMergeExt = mergeCompartmentRef.current.of(
      buildMergeExtension(headContent, handleChunkAction),
    )

    const state = EditorState.create({
      doc: data.code,
      extensions: [
        lineNumbers({
          formatNumber: (n) => String(n + data.startLine - 1),
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
        getLanguageExt(data.filePath),
        oneDark,
        initialMergeExt,
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
          // Override @codemirror/merge defaults: drop the 2px-gradient
          // faux-underline on changedText spans, and bump line-bg + gutter
          // saturation with a luminance gap (red darker than green) so
          // red-green colorblind users can still distinguish the two.
          '&.cm-merge-a .cm-changedText, &.cm-merge-b .cm-changedText, .cm-deletedChunk .cm-deletedText, &.cm-merge-b .cm-deletedText': {
            background: 'none',
          },
          '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': {
            backgroundColor: 'rgba(220, 60, 50, 0.22)',
          },
          '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': {
            backgroundColor: 'rgba(80, 200, 100, 0.22)',
          },
          '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': {
            background: '#dc2626',
          },
          '&.cm-merge-b .cm-changedLineGutter': {
            background: '#22c55e',
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

  // Swap the merge extension in-place when git HEAD content for this file
  // changes (file becomes dirty/clean, HEAD SHA advances, etc.) without
  // destroying the editor or losing the user's unsaved edits.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: mergeCompartmentRef.current.reconfigure(
        buildMergeExtension(headContent, handleChunkAction),
      ),
    })
  }, [headContent, handleChunkAction])

  const lineCount = data.endLine - data.startLine + 1
  const displayPath = toRepoRelative(data.filePath, repoPath)
  const lastSlash = displayPath.lastIndexOf('/')
  const dirPrefix = lastSlash >= 0 ? displayPath.slice(0, lastSlash + 1) : ''
  const fileName = lastSlash >= 0 ? displayPath.slice(lastSlash + 1) : displayPath

  return (
    <div
      className={`relative pointer-events-auto bg-background border border-r-0 rounded-l-lg nodrag nopan ${flags.isFocused ? nodeFocusRing(true, 'bordered') : 'border-border'} ${editorFocused ? 'border-primary/30' : ''} ${flags.isHidden ? 'opacity-30' : ''}`}
      style={{ width: nodeWidth }}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50 bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium truncate" title={displayPath}>
            {dirPrefix && <span className="text-foreground/40">{dirPrefix}</span>}
            <span className="text-foreground">{fileName}</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isNewFile && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/40 text-green-400 font-mono">
              new
            </span>
          )}
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
        onMouseDown={resizeHandleProps.onMouseDown}
        className="nodrag nopan group/handle absolute top-0 -right-3 bottom-0 w-3 cursor-col-resize
          flex items-center z-10"
        role="separator"
      >
        <div className="absolute inset-y-0 left-0 w-px
          bg-foreground/10 group-hover/handle:bg-primary/40 group-data-[resizing]/handle:bg-primary/40 transition-colors" />
        <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[2px] rounded-lg transition-colors
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
