import {
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useDragHandle } from '@/hooks/useDragHandle'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
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
import { EditorState, Compartment, type Extension } from '@codemirror/state'
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
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { oneDark } from '@codemirror/theme-one-dark'
import { unifiedMergeView } from '@codemirror/merge'
import { getPlatform } from '@/services/platform'
import { isMarkdownFile } from '@/lib/constants'
import type { CodeNode, ImportRefItem } from '@/types/nodes'
import { getNodeFlags, nodeFocusRing } from './nodeUtils'
import { registerEditorView, unregisterEditorView } from './codeNodeRegistry'
import { useCanvasStore, type ImportRef } from '@/store/canvas'
import { Pill, REF_HEIGHT } from './ImportRefNode'
import { useGitStore } from '@/store/git'
import { samePath, toRepoRelative } from '@/lib/repoPath'

const MarkdownPreview = lazy(() => import('./MarkdownPreview'))

function getLanguageExt(filePath: string) {
  if (/\.(tsx?)$/.test(filePath)) return javascript({ typescript: true, jsx: true })
  if (/\.(jsx?)$/.test(filePath)) return javascript({ jsx: true })
  if (/\.json$/.test(filePath)) return json()
  if (/\.css$/.test(filePath)) return css()
  return javascript({ typescript: true })
}

const MIN_CODE_NODE_WIDTH = 280
const CODE_NODE_HEIGHT_RESERVED = 120
const CM_PAD_TOP = 4 // CodeMirror .cm-content padding-top
const REF_GAP = 16 // Space between code right edge and annotation pills

interface RefLine {
  items: ImportRefItem[]
  showConnector: boolean
}

function computeRefLineLayout(refs: ImportRef[]): Map<number, RefLine> {
  const imports = refs.filter((r) => r.kind === 'import')
  const importedBy = refs.filter((r) => r.kind === 'imported-by')

  const lineEntries = new Map<number, ImportRef[]>()
  const add = (line: number, ref: ImportRef) => {
    if (!lineEntries.has(line)) lineEntries.set(line, [])
    lineEntries.get(line)!.push(ref)
  }

  for (const ref of imports) add(ref.line, ref)

  // Imported-by: group refs by their anchor line (per-export) and spread
  // each group downward. A line is only blocked by imported-by refs from
  // a *different* group, so groups don't collide.
  const ibAnchorLines = new Set<number>()
  if (importedBy.length > 0) {
    const ibByLine = new Map<number, ImportRef[]>()
    for (const ref of importedBy) {
      if (!ibByLine.has(ref.line)) ibByLine.set(ref.line, [])
      ibByLine.get(ref.line)!.push(ref)
    }

    const sortedAnchors = [...ibByLine.keys()].sort((a, b) => a - b)
    for (const anchorLine of sortedAnchors) {
      ibAnchorLines.add(anchorLine)
      const group = ibByLine.get(anchorLine)!
      const count = group.length
      let maxRows = 0
      let probe = anchorLine
      while (maxRows < count) {
        const occupants = lineEntries.get(probe)
        if (occupants && occupants.some((r) => r.kind === 'imported-by')) break
        maxRows++
        probe++
      }
      if (maxRows < 1) maxRows = 1
      const numCols = Math.ceil(count / maxRows)
      const rowsPerCol = Math.ceil(count / numCols)
      for (let ri = 0; ri < count; ri++) {
        const line = anchorLine + (ri % rowsPerCol)
        add(line, group[ri])
      }
    }
  }

  const result = new Map<number, RefLine>()

  for (const [line, entries] of lineEntries) {
    const items: ImportRefItem[] = entries.map((ref) => ({
      label: ref.label,
      resolvedPath: ref.resolvedPath,
      kind: ref.kind,
    }))
    const hasIB = entries.some((e) => e.kind === 'imported-by')
    const hasImport = entries.some((e) => e.kind === 'import')
    const showConnector = hasImport || (hasIB && ibAnchorLines.has(line))
    result.set(line, { items, showConnector })
  }

  return result
}

/**
 * Returns an empty array when there is no HEAD content, so reconfiguring
 * with this cleanly removes the diff highlighting.
 *
 * onChunkAction fires after CodeMirror's default accept/reject transaction
 * has already mutated the doc — caller persists it so git picks it up.
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
  const isMd = isMarkdownFile(data.filePath)
  const [mdPreview, setMdPreview] = useState(isMd)
  const [mdContent, setMdContent] = useState(data.code)
  const storeWidth = useCanvasStore((s) => s.codeNodeWidth)
  const setCodeNodeWidth = useCanvasStore((s) => s.setCodeNodeWidth)
  const [nodeWidth, setNodeWidth] = useState<number>(storeWidth)
  const [editorHeight, setEditorHeight] = useState(0)
  const refOverlayRef = useRef<HTMLDivElement>(null)
  const [geometryVer, setGeometryVer] = useState(0)
  const [linePositions, setLinePositions] = useState<Map<number, number>>(new Map())

  const importRefs = useCanvasStore((s) => {
    const previewIdx = s.currentColumnIndex + 1
    const col = s.columns[previewIdx]
    return col?.kind === 'file' ? col.importRefs : undefined
  })
  const refLineLayout = useMemo(() => {
    if (!importRefs || importRefs.length === 0) return null
    return computeRefLineLayout(importRefs)
  }, [importRefs])

  const gitStatus = useGitStore((s) => s.status)
  const repoPath = useGitStore((s) => s.repoPath)
  const loadHeadContent = useGitStore((s) => s.loadHeadContent)

  const gitEntry = useMemo(() => {
    if (!gitStatus) return null
    return gitStatus.files.find((f) => samePath(data.filePath, f.path, repoPath)) ?? null
  }, [gitStatus, data.filePath, repoPath])

  const isNewFile = gitEntry?.status === 'A' || gitEntry?.status === 'U'
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

  useEffect(() => {
    setMdContent(data.code)
  }, [data.code])

  useEffect(() => {
    setNodeWidth(storeWidth)
  }, [storeWidth])

  const dragStartWidthRef = useRef(0)
  const widthFromDelta = (deltaX: number) =>
    Math.max(MIN_CODE_NODE_WIDTH, dragStartWidthRef.current + deltaX)
  const { handleProps: resizeHandleProps } = useDragHandle({
    cursor: 'col-resize',
    onStart: () => {
      dragStartWidthRef.current = nodeWidth
    },
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
    (_type: 'accept' | 'reject') => {
      void saveToFile()
    },
    [saveToFile],
  )

  useEffect(() => {
    if (!editorRef.current) return

    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    // Fresh compartment per editor instance — compartments are tied to an
    // EditorState and not reusable across destroyed views.
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
          if (update.docChanged) setDirty(true)
          if (update.focusChanged) setEditorFocused(update.view.hasFocus)
          if (update.geometryChanged) setGeometryVer((v) => v + 1)
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
              const container = document.querySelector(
                '[data-canvas-container]',
              ) as HTMLElement | null
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
            lineHeight: '18px',
          },
          // Override @codemirror/merge defaults: drop the faux-underline on
          // changedText, and use a luminance gap (red darker than green) so
          // red-green colorblind users can distinguish the two.
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

    const view = new EditorView({ state, parent: editorRef.current })
    viewRef.current = view
    registerEditorView(view)
    setGeometryVer((v) => v + 1)

    const scrollDOM = view.scrollDOM
    const handleEditorScroll = () => {
      if (refOverlayRef.current) {
        refOverlayRef.current.style.transform = `translateY(${-scrollDOM.scrollTop}px)`
      }
    }
    scrollDOM.addEventListener('scroll', handleEditorScroll, { passive: true })
    const ro = new ResizeObserver(() => setEditorHeight(scrollDOM.clientHeight))
    ro.observe(scrollDOM)
    setEditorHeight(scrollDOM.clientHeight)

    return () => {
      scrollDOM.removeEventListener('scroll', handleEditorScroll)
      ro.disconnect()
      unregisterEditorView(view)
      view.destroy()
      viewRef.current = null
    }
  }, [data.code, data.filePath, data.startLine]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: mergeCompartmentRef.current.reconfigure(
        buildMergeExtension(headContent, handleChunkAction),
      ),
    })
  }, [headContent, handleChunkAction])

  // Lines beyond document end are stacked at REF_HEIGHT intervals below
  // the last line to avoid overlap.
  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view || !refLineLayout || refLineLayout.size === 0) {
      setLinePositions(new Map())
      return
    }
    const positions = new Map<number, number>()
    const maxLine = view.state.doc.lines
    const lastBlock = view.lineBlockAt(view.state.doc.line(maxLine).from)
    const beyondTop = lastBlock.top + lastBlock.height

    for (const line of refLineLayout.keys()) {
      if (line >= 1 && line <= maxLine) {
        try {
          positions.set(line, view.lineBlockAt(view.state.doc.line(line).from).top)
        } catch {
          /* line out of range */
        }
      } else if (line > maxLine) {
        positions.set(line, beyondTop + (line - maxLine - 1) * REF_HEIGHT)
      }
    }
    setLinePositions(positions)
  }, [refLineLayout, geometryVer])

  const overlayHeight = useMemo(() => {
    if (!refLineLayout || refLineLayout.size === 0) return editorHeight
    let maxBottom = 0
    for (const [line] of refLineLayout) {
      const top = linePositions.get(line)
      const posTop = CM_PAD_TOP + (top ?? (line - 1) * REF_HEIGHT)
      maxBottom = Math.max(maxBottom, posTop + REF_HEIGHT)
    }
    return Math.max(editorHeight, maxBottom)
  }, [refLineLayout, editorHeight, linePositions])

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
          {isMd && (
            <button
              type="button"
              onClick={() => {
                if (!mdPreview && viewRef.current) {
                  setMdContent(viewRef.current.state.doc.toString())
                }
                setMdPreview((v) => !v)
              }}
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono cursor-pointer transition-colors ${
                mdPreview
                  ? 'bg-primary/20 text-primary'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {mdPreview ? 'preview' : 'source'}
            </button>
          )}
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

      <div className="relative">
        <div
          ref={editorRef}
          className="nowheel"
          style={{ display: mdPreview ? 'none' : undefined }}
        />
        {mdPreview && (
          <Suspense
            fallback={
              <div
                className="px-4 py-3 text-xs text-muted-foreground"
                style={{ maxHeight: `calc(100vh - ${CODE_NODE_HEIGHT_RESERVED}px)` }}
              >
                Loading…
              </div>
            }
          >
            <MarkdownPreview
              content={mdContent}
              filePath={data.filePath}
              maxHeight={`calc(100vh - ${CODE_NODE_HEIGHT_RESERVED}px)`}
            />
          </Suspense>
        )}
        {!mdPreview && refLineLayout && editorHeight > 0 && (
          <div
            className="absolute top-0 pointer-events-none"
            style={{
              left: `calc(100% + ${REF_GAP / 4}px)`,
              height: overlayHeight,
              width: 999,
              overflow: 'hidden',
            }}
          >
            <div ref={refOverlayRef}>
              {[...refLineLayout.entries()]
                .sort(([a], [b]) => a - b)
                .map(([line, layout]) => {
                  const lineColor =
                    layout.items[0]?.kind === 'imported-by' ? 'bg-violet-400/20' : 'bg-green-400/20'
                  const top = linePositions.get(line)
                  return (
                    <div
                      key={line}
                      className="absolute flex items-center gap-0.5"
                      style={{
                        top: CM_PAD_TOP + (top ?? (line - 1) * REF_HEIGHT),
                        height: REF_HEIGHT,
                      }}
                    >
                      {layout.showConnector ? (
                        <div className="flex items-center shrink-0" style={{ width: REF_GAP + 12 }}>
                          <div className={`h-px flex-1 ${lineColor}`} />
                          <span className="text-[9px] text-muted-foreground/40 font-mono leading-none px-px">
                            {line}
                          </span>
                          <div className={`h-px flex-1 ${lineColor}`} />
                        </div>
                      ) : (
                        <div className="shrink-0" style={{ width: REF_GAP + 12 }} />
                      )}
                      {layout.items.map((item, idx) => (
                        <Pill key={`${item.kind}:${item.resolvedPath}:${idx}`} item={item} />
                      ))}
                    </div>
                  )
                })}
            </div>
          </div>
        )}
      </div>

      <div
        ref={resizeRef}
        onMouseDown={resizeHandleProps.onMouseDown}
        className="nodrag nopan group/handle absolute top-0 -right-3 bottom-0 w-3 cursor-col-resize
          flex items-center z-10"
        role="separator"
      >
        <div
          className="absolute inset-y-0 left-0 w-px
          bg-foreground/10 group-hover/handle:bg-primary/40 group-data-[resizing]/handle:bg-primary/40 transition-colors"
        />
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[2px] rounded-lg transition-colors
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
