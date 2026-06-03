import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { EditorState, Compartment } from '@codemirror/state'
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
import { vscodeDark } from './cmThemeVSCode'
import { getLanguageExt } from './cmLanguages'
import {
  rainbowBrackets,
  buildMergeExtension,
  getChunks,
  acceptChunk,
  rejectChunk,
  commentHighlightField,
  commentHighlightTheme,
  setCommentRanges,
} from './cmPlugins'
import { getPlatform } from '@/services/platform'
import { isMarkdownFile } from '@/lib/fileClassification'
import type { CodeNode, ImportRefItem } from '@/types/nodes'
import { getNodeFlags, nodeFocusRing } from './nodeUtils'
import { registerEditorView, unregisterEditorView } from './codeNodeRegistry'
import { useCanvasStore, type ImportRef } from '@/store/canvas'
import { Pill, REF_HEIGHT } from './ImportRefNode'
import { useGitStore } from '@/store/git'
import { useReviewStore } from '@/store/review'
import { useShallow } from 'zustand/react/shallow'
import { samePath, toRepoRelative } from '@/lib/repoPath'

import MarkdownPreview from './MarkdownPreview'

const MIN_CODE_NODE_WIDTH = 280
const CODE_NODE_HEIGHT_RESERVED = 120
const CM_PAD_TOP = 4
const REF_GAP = 16

interface RefLine {
  items: ImportRefItem[]
  showConnector: boolean
}

function toItem(ref: ImportRef): ImportRefItem {
  return {
    label: ref.label,
    resolvedPath: ref.resolvedPath,
    kind: ref.kind,
    targetLine: ref.targetLine,
  }
}

function computeRefLineLayouts(refs: ImportRef[]): {
  inlineImports: Map<number, ImportRefItem[]>
  rightSide: Map<number, RefLine>
} {
  const inlineImports = new Map<number, ImportRefItem[]>()
  for (const ref of refs.filter((r) => r.kind === 'import')) {
    if (!inlineImports.has(ref.line)) inlineImports.set(ref.line, [])
    inlineImports.get(ref.line)!.push(toItem(ref))
  }

  const rightSide = new Map<number, RefLine>()
  const importedBy = refs.filter((r) => r.kind === 'imported-by')
  if (importedBy.length === 0) return { inlineImports, rightSide }

  const ibByLine = new Map<number, ImportRef[]>()
  for (const ref of importedBy) {
    if (!ibByLine.has(ref.line)) ibByLine.set(ref.line, [])
    ibByLine.get(ref.line)!.push(ref)
  }

  const lineEntries = new Map<number, ImportRef[]>()
  const add = (line: number, ref: ImportRef) => {
    if (!lineEntries.has(line)) lineEntries.set(line, [])
    lineEntries.get(line)!.push(ref)
  }

  const ibAnchorLines = new Set<number>()
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

  for (const [line, entries] of lineEntries) {
    rightSide.set(line, {
      items: entries.map(toItem),
      showConnector: ibAnchorLines.has(line),
    })
  }

  return { inlineImports, rightSide }
}

function CodeNodeSkeleton({ lineCount, startLine }: { lineCount: number; startLine: number }) {
  const visibleLines = Math.min(lineCount, 40)
  return (
    <div
      className="overflow-hidden"
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: '12px',
        lineHeight: '18px',
      }}
    >
      {Array.from({ length: visibleLines }, (_, i) => {
        const lineNum = startLine + i
        const widthPercent = 20 + ((lineNum * 7) % 60)
        return (
          <div key={i} className="flex" style={{ height: 18 }}>
            <span
              className="text-right shrink-0 select-none text-muted-foreground/30"
              style={{ width: 40, paddingRight: 8, fontSize: '12px' }}
            >
              {lineNum}
            </span>
            <div
              className="rounded bg-foreground/[0.04]"
              style={{ width: `${widthPercent}%`, height: 10, marginTop: 4 }}
            />
          </div>
        )
      })}
    </div>
  )
}

export default memo(function CodeNode({ data }: NodeProps<CodeNode>) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const mergeCompartmentRef = useRef<Compartment>(new Compartment())
  const wrapCompartmentRef = useRef<Compartment>(new Compartment())
  const scrollHandlerRef = useRef<{ scrollDOM: HTMLElement; handler: () => void } | null>(null)
  const resizeObRef = useRef<ResizeObserver | null>(null)
  const flags = getNodeFlags(data)
  const reviewFilePath = data.review?.filePath
  const [commentDraft, setCommentDraft] = useState<{
    startLine: number
    endLine: number
    snippet: string
    top: number
  } | null>(null)
  const [commentBody, setCommentBody] = useState('')
  const [editorReady, setEditorReady] = useState(false)
  const [editorFocused, setEditorFocused] = useState(false)
  const [lineWrap, setLineWrap] = useState(false)
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty
  const saveToFileRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false))
  const [saving, setSaving] = useState(false)
  const isMd = isMarkdownFile(data.filePath)
  const mdPreviewEnabled = useCanvasStore((s) => s.mdPreviewEnabled)
  const [mdPreview, setMdPreview] = useState(() => isMd && mdPreviewEnabled)
  const [mdContent, setMdContent] = useState(data.code)
  const storeWidth = useCanvasStore((s) => s.codeNodeWidth)
  const setCodeNodeWidth = useCanvasStore((s) => s.setCodeNodeWidth)
  const setPreviewReady = useCanvasStore((s) => s.setPreviewReady)
  const [nodeWidth, setNodeWidth] = useState<number>(storeWidth)
  const [editorHeight, setEditorHeight] = useState(0)
  const refOverlayRef = useRef<HTMLDivElement>(null)
  const inlineOverlayRef = useRef<HTMLDivElement>(null)
  const [geometryVer, setGeometryVer] = useState(0)
  const [pinnedStripe, setPinnedStripe] = useState<number | null>(null)
  const [linePositions, setLinePositions] = useState<Map<number, number>>(new Map())
  // Tracks the headContent value that linePositions was measured against. Pills
  // wait until this matches the current headContent so they never render at
  // pre-merge coordinates after the diff blocks are applied.
  const [positionsHeadContent, setPositionsHeadContent] = useState<string | null | undefined>(
    undefined,
  )
  const [minimapStripes, setMinimapStripes] = useState<
    { startFrac: number; endFrac: number; color: string; fromPos: number }[]
  >([])

  const importRefs = useCanvasStore((s) => {
    const previewIdx = s.currentColumnIndex + 1
    const col = s.columns[previewIdx]
    return col?.kind === 'file' ? col.importRefs : undefined
  })
  const { inlineImports, rightSideLayout } = useMemo(() => {
    if (!importRefs || importRefs.length === 0) {
      return { inlineImports: null, rightSideLayout: null }
    }
    const { inlineImports: inline, rightSide } = computeRefLineLayouts(importRefs)
    return {
      inlineImports: inline.size > 0 ? inline : null,
      rightSideLayout: rightSide.size > 0 ? rightSide : null,
    }
  }, [importRefs])

  const hasHeadOverride = data.headOverride !== undefined
  const isReadOnly = data.readOnly === true

  const gitStatus = useGitStore((s) => s.status)
  const repoPath = useGitStore((s) => s.repoPath)
  const loadHeadContent = useGitStore((s) => s.loadHeadContent)

  const fileComments = useReviewStore(
    useShallow((s) =>
      reviewFilePath ? (s.active?.comments.filter((c) => c.filePath === reviewFilePath) ?? []) : [],
    ),
  )

  const gitEntry = useMemo(() => {
    if (hasHeadOverride || !gitStatus) return null
    return gitStatus.files.find((f) => samePath(data.filePath, f.path, repoPath)) ?? null
  }, [hasHeadOverride, gitStatus, data.filePath, repoPath])

  const isNewFile = gitEntry?.status === 'A' || gitEntry?.status === 'U'
  // `undefined` means "not yet determined"; we treat it as null for the merge
  // extension but use it to gate pill rendering so they don't appear until the
  // editor's diff blocks have been applied.
  const [headContent, setHeadContent] = useState<string | null | undefined>(undefined)
  const headContentRef = useRef<string | null>(null)
  headContentRef.current = headContent ?? null

  useEffect(() => {
    if (hasHeadOverride) {
      setHeadContent(data.headOverride ?? null)
      return
    }
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
  }, [
    hasHeadOverride,
    data.headOverride,
    gitEntry,
    isNewFile,
    data.filePath,
    repoPath,
    loadHeadContent,
  ])

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
      void useGitStore.getState().refresh()
      return true
    } catch (err) {
      console.error('Failed to save:', err)
      return false
    } finally {
      setSaving(false)
    }
  }, [data.filePath])
  saveToFileRef.current = saveToFile

  const handleAcceptChunk = useCallback(
    (pos: number) => {
      const view = viewRef.current
      if (!view) return
      acceptChunk(view, pos)
      void saveToFile()
    },
    [saveToFile],
  )

  const handleRejectChunk = useCallback(
    (pos: number) => {
      const view = viewRef.current
      if (!view) return
      rejectChunk(view, pos)
      void saveToFile()
    },
    [saveToFile],
  )

  // Auto-save: periodic (every 5 seconds if dirty)
  useEffect(() => {
    if (isReadOnly) return
    const id = setInterval(() => {
      if (dirtyRef.current) void saveToFile()
    }, 5000)
    return () => clearInterval(id)
  }, [isReadOnly, saveToFile])

  // Auto-save: on window focus loss and before close
  useEffect(() => {
    if (isReadOnly) return
    const onVisibilityChange = () => {
      if (document.hidden && dirtyRef.current) void saveToFile()
    }
    const onBeforeUnload = () => {
      if (dirtyRef.current) void saveToFile()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [isReadOnly, saveToFile])

  useEffect(() => {
    if (!editorRef.current) return

    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    setEditorReady(false)

    const container = editorRef.current
    const rafId = requestAnimationFrame(() => {
      if (!container.isConnected) return

      mergeCompartmentRef.current = new Compartment()
      wrapCompartmentRef.current = new Compartment()
      const initialMergeExt = mergeCompartmentRef.current.of(
        buildMergeExtension(headContentRef.current),
      )
      const initialWrapExt = wrapCompartmentRef.current.of([])

      const langExt = getLanguageExt(data.filePath)

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
          ...(reviewFilePath ? [commentHighlightField, commentHighlightTheme] : []),
          vscodeDark,
          ...(isReadOnly ? [EditorState.readOnly.of(true)] : []),
          initialMergeExt,
          initialWrapExt,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setDirty(true)
            if (update.focusChanged) {
              setEditorFocused(update.view.hasFocus)
              if (!update.view.hasFocus && dirtyRef.current) void saveToFileRef.current()
            }
            if (update.geometryChanged) setGeometryVer((v) => v + 1)
            if (reviewFilePath && update.selectionSet) {
              const sel = update.state.selection.main
              if (sel.empty) {
                setCommentDraft(null)
              } else {
                const doc = update.state.doc
                const startLine = doc.lineAt(sel.from).number
                const endLine = doc.lineAt(sel.to).number
                const snippet = update.state.sliceDoc(
                  doc.line(startLine).from,
                  doc.line(endLine).to,
                )
                const top = update.view.coordsAtPos(doc.line(startLine).from)
                const scrollTop = update.view.scrollDOM.scrollTop
                const editorTop = update.view.scrollDOM.getBoundingClientRect().top
                setCommentDraft({
                  startLine,
                  endLine,
                  snippet,
                  top: top ? top.top - editorTop + scrollTop : 0,
                })
              }
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
              color: '#fbbf24',
            },
            '&.cm-focused': {
              outline: 'none',
            },
          }),
        ],
      })

      const view = new EditorView({ state, parent: container })
      viewRef.current = view
      registerEditorView(view)
      setEditorReady(true)
      setPreviewReady(true)
      setGeometryVer((v) => v + 1)

      const scrollDOM = view.scrollDOM
      const handleEditorScroll = () => {
        const ty = `translateY(${-scrollDOM.scrollTop}px)`
        if (refOverlayRef.current) refOverlayRef.current.style.transform = ty
        if (inlineOverlayRef.current) inlineOverlayRef.current.style.transform = ty
      }
      scrollDOM.addEventListener('scroll', handleEditorScroll, { passive: true })
      scrollHandlerRef.current = { scrollDOM, handler: handleEditorScroll }
      const ro = new ResizeObserver(() => setEditorHeight(scrollDOM.clientHeight))
      ro.observe(scrollDOM)
      resizeObRef.current = ro
      setEditorHeight(scrollDOM.clientHeight)
    })

    return () => {
      cancelAnimationFrame(rafId)
      resizeObRef.current?.disconnect()
      resizeObRef.current = null
      const sh = scrollHandlerRef.current
      if (sh) {
        sh.scrollDOM.removeEventListener('scroll', sh.handler)
        scrollHandlerRef.current = null
      }
      if (viewRef.current) {
        unregisterEditorView(viewRef.current)
        viewRef.current.destroy()
        viewRef.current = null
      }
    }
  }, [data.code, data.filePath, data.startLine]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (headContent === undefined) return
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: mergeCompartmentRef.current.reconfigure(buildMergeExtension(headContent)),
    })
  }, [headContent])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: wrapCompartmentRef.current.reconfigure(lineWrap ? EditorView.lineWrapping : []),
    })
  }, [lineWrap])

  useEffect(() => {
    if (!reviewFilePath) return
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: setCommentRanges.of(fileComments.map((c) => ({ from: c.startLine, to: c.endLine }))),
    })
  }, [reviewFilePath, fileComments, editorReady])

  const pendingScroll = useCanvasStore((s) => s.pendingScroll)
  useEffect(() => {
    if (!editorReady || !pendingScroll) return
    if (!samePath(data.filePath, pendingScroll.filePath, repoPath ?? '')) return
    const view = viewRef.current
    if (!view) return

    const localLine = pendingScroll.line - data.startLine + 1
    if (localLine < 1 || localLine > view.state.doc.lines) {
      useCanvasStore.getState().setPendingScroll(null)
      return
    }
    const linePos = view.state.doc.line(localLine).from
    view.dispatch({
      selection: { anchor: linePos },
      effects: EditorView.scrollIntoView(linePos, { y: 'center' }),
    })
    view.focus()
    useCanvasStore.getState().setPendingScroll(null)
  }, [editorReady, pendingScroll, data.filePath, data.startLine, repoPath])

  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view || (!rightSideLayout && !inlineImports)) {
      setLinePositions(new Map())
      return
    }
    // Use requestMeasure so we read line tops during CodeMirror's DOM-read
    // phase, when heights are guaranteed measured (not still estimates from
    // the initial HeightMap). Synchronous lineBlockAt right after `new
    // EditorView` can return estimate-based tops that shift once CM does
    // its first measure pass.
    let cancelled = false
    const headContentAtRequest = headContent
    view.requestMeasure({
      key: 'codeNode-linePositions',
      read: (v) => {
        const positions = new Map<number, number>()
        const maxLine = v.state.doc.lines
        const lastBlock = v.lineBlockAt(v.state.doc.line(maxLine).from)
        const beyondTop = lastBlock.top + lastBlock.height
        const allLines = new Set<number>([
          ...(rightSideLayout?.keys() ?? []),
          ...(inlineImports?.keys() ?? []),
        ])
        for (const line of allLines) {
          if (line >= 1 && line <= maxLine) {
            try {
              positions.set(line, v.lineBlockAt(v.state.doc.line(line).from).top)
            } catch {
              /* line out of range */
            }
          } else if (line > maxLine) {
            positions.set(line, beyondTop + (line - maxLine - 1) * REF_HEIGHT)
          }
        }
        return positions
      },
      write: (positions) => {
        if (cancelled) return
        setLinePositions(positions)
        setPositionsHeadContent(headContentAtRequest)
      },
    })
    return () => {
      cancelled = true
    }
  }, [rightSideLayout, inlineImports, geometryVer, headContent])

  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view) {
      setMinimapStripes([])
      return
    }
    const result = getChunks(view.state)
    if (!result || result.chunks.length === 0) {
      setMinimapStripes([])
      return
    }
    const totalLines = view.state.doc.lines
    if (totalLines === 0) {
      setMinimapStripes([])
      return
    }
    const stripes = result.chunks.map((chunk) => {
      const startLine = view.state.doc.lineAt(Math.min(chunk.fromB, view.state.doc.length)).number
      const endLine = view.state.doc.lineAt(
        Math.min(Math.max(chunk.toB - 1, chunk.fromB), view.state.doc.length),
      ).number
      const isDelete = chunk.fromB === chunk.toB
      const isInsert = chunk.fromA === chunk.toA
      const color = isDelete ? '#dc2626' : isInsert ? '#22c55e' : '#3b82f6'
      return {
        startFrac: (startLine - 1) / totalLines,
        endFrac: Math.min(endLine / totalLines, 1),
        color,
        fromPos: chunk.fromB,
      }
    })
    setMinimapStripes(stripes)
  }, [geometryVer, headContent])

  const overlayHeight = useMemo(() => {
    if (!rightSideLayout || rightSideLayout.size === 0) return editorHeight
    let maxBottom = 0
    for (const [line] of rightSideLayout) {
      const top = linePositions.get(line)
      const posTop = CM_PAD_TOP + (top ?? (line - 1) * REF_HEIGHT)
      maxBottom = Math.max(maxBottom, posTop + REF_HEIGHT)
    }
    return Math.max(editorHeight, maxBottom)
  }, [rightSideLayout, editorHeight, linePositions])

  // Pills stay hidden until: the editor is mounted, the file's HEAD content
  // has been resolved (so the merge view's deletion blocks are applied), and
  // linePositions has been measured against that same headContent — so the
  // tops we render against actually match the editor's current layout.
  const pillsReady =
    editorReady &&
    headContent !== undefined &&
    positionsHeadContent === headContent &&
    linePositions.size > 0

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
                setMdPreview((v) => {
                  useCanvasStore.setState({ mdPreviewEnabled: !v })
                  return !v
                })
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
          {data.commitHash && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-400 font-mono">
              {data.commitHash.slice(0, 7)}
            </span>
          )}
          {isNewFile && !isReadOnly && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/40 text-green-400 font-mono">
              new
            </span>
          )}
          {dirty && !isReadOnly && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-800/40 text-yellow-400 font-mono">
              {saving ? 'saving...' : 'modified'}
            </span>
          )}
          {editorFocused && !isReadOnly && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-mono">
              editing
            </span>
          )}
          <button
            type="button"
            onClick={() => setLineWrap((v) => !v)}
            className={`text-[10px] px-1.5 py-0.5 rounded font-mono cursor-pointer transition-colors ${
              lineWrap
                ? 'bg-primary/20 text-primary'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
            title={lineWrap ? 'Disable line wrapping' : 'Enable line wrapping'}
          >
            {lineCount}L{lineWrap ? '↩' : ''}
          </button>
        </div>
      </div>

      <div className="relative flex">
        <div className="relative overflow-hidden flex-1 min-w-0">
          {!editorReady && !mdPreview && (
            <div className="absolute inset-0 z-10 bg-background">
              <CodeNodeSkeleton lineCount={lineCount} startLine={data.startLine} />
            </div>
          )}
          <div
            ref={editorRef}
            className="nowheel"
            style={{ display: mdPreview ? 'none' : undefined }}
          />
          {mdPreview && (
            <MarkdownPreview
              content={mdContent}
              filePath={data.filePath}
              maxHeight={`calc(100vh - ${CODE_NODE_HEIGHT_RESERVED}px)`}
            />
          )}
          {!mdPreview && inlineImports && pillsReady && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div ref={inlineOverlayRef} className="absolute inset-0">
                {[...inlineImports.entries()].map(([line, items]) => {
                  const top = linePositions.get(line)
                  return (
                    <div
                      key={line}
                      className="absolute right-1 flex items-center gap-0.5 justify-end"
                      style={{
                        top: CM_PAD_TOP + (top ?? (line - 1) * REF_HEIGHT),
                        height: REF_HEIGHT,
                      }}
                    >
                      {items.map((item, idx) => (
                        <Pill key={`${item.kind}:${item.resolvedPath}:${idx}`} item={item} />
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {reviewFilePath && commentDraft && (
            <div
              className="absolute right-2 z-20 w-64 rounded border border-border bg-background shadow-lg p-2 pointer-events-auto"
              style={{ top: commentDraft.top }}
            >
              <div className="text-[10px] text-muted-foreground mb-1 font-mono">
                Lines {commentDraft.startLine}
                {commentDraft.endLine !== commentDraft.startLine ? `–${commentDraft.endLine}` : ''}
              </div>
              <textarea
                autoFocus
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Comment for the agent…"
                className="w-full h-16 text-xs bg-muted/40 rounded p-1 outline-none resize-none"
              />
              <div className="flex justify-end gap-1 mt-1">
                <button
                  type="button"
                  onClick={() => {
                    setCommentDraft(null)
                    setCommentBody('')
                  }}
                  className="text-[10px] px-1.5 py-0.5 rounded hover:bg-muted cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!commentBody.trim()}
                  onClick={() => {
                    useReviewStore
                      .getState()
                      .addComment(
                        reviewFilePath,
                        commentDraft.startLine,
                        commentDraft.endLine,
                        commentDraft.snippet,
                        commentBody.trim(),
                      )
                    setCommentDraft(null)
                    setCommentBody('')
                  }}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary disabled:opacity-40 cursor-pointer"
                >
                  Comment
                </button>
              </div>
            </div>
          )}
        </div>
        {!mdPreview && !isReadOnly && minimapStripes.length > 0 && editorHeight > 0 && (
          <div className="relative shrink-0 pointer-events-auto z-10" style={{ width: 22 }}>
            <div
              className="relative h-full"
              style={{
                background: 'rgba(0,0,0,0.25)',
                borderLeft: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              {minimapStripes.map((stripe, i) => {
                const minH = 4
                const top = stripe.startFrac * 100
                const height = Math.max(
                  (stripe.endFrac - stripe.startFrac) * 100,
                  (minH / editorHeight) * 100,
                )
                const isPinned = pinnedStripe === i
                return (
                  <div
                    key={i}
                    className="absolute right-0 group/stripe"
                    style={{ top: `${top}%`, height: `${height}%`, minHeight: minH, left: -38 }}
                  >
                    <div
                      className={`absolute top-0 bottom-0 right-0 transition-opacity cursor-pointer ${isPinned ? 'opacity-100' : 'opacity-70 group-hover/stripe:opacity-100'}`}
                      style={{ width: 22, backgroundColor: stripe.color }}
                      onClick={() => {
                        const view = viewRef.current
                        if (view) {
                          view.dispatch({
                            effects: EditorView.scrollIntoView(stripe.fromPos, { y: 'center' }),
                          })
                        }
                        setPinnedStripe(isPinned ? null : i)
                      }}
                    />
                    <div
                      className={`absolute left-0 top-1/2 -translate-y-1/2 ${isPinned ? 'flex' : 'hidden group-hover/stripe:flex'} gap-0.5`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          handleAcceptChunk(stripe.fromPos)
                          setPinnedStripe(null)
                        }}
                        className="h-4 w-4 flex items-center justify-center rounded text-[9px] font-mono cursor-pointer bg-green-900/80 text-green-400 hover:bg-green-800"
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handleRejectChunk(stripe.fromPos)
                          setPinnedStripe(null)
                        }}
                        className="h-4 w-4 flex items-center justify-center rounded text-[9px] font-mono cursor-pointer bg-red-900/80 text-red-400 hover:bg-red-800"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {!mdPreview && rightSideLayout && pillsReady && (
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
              {[...rightSideLayout.entries()]
                .sort(([a], [b]) => a - b)
                .map(([line, layout]) => {
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
                          <div className="h-px flex-1 bg-violet-400/20" />
                          <span className="text-[9px] text-muted-foreground/40 font-mono leading-none px-px">
                            {line}
                          </span>
                          <div className="h-px flex-1 bg-violet-400/20" />
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
      <Handle type="source" id="right" position={Position.Right} className="opacity-0" />
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <Handle type="target" id="left" position={Position.Left} className="opacity-0" />
      <Handle
        type="target"
        id="title"
        position={Position.Left}
        style={{ top: 14 }}
        className="opacity-0"
      />
    </div>
  )
})
