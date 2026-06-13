import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useDragHandle } from '@/hooks/useDragHandle'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { EditorView } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { buildMergeExtension, getChunks, setCommentRanges } from './cmPlugins'
import { getPlatform } from '@/services/platform'
import { markSelfWrite, onExternalFileChange } from '@/services/fileChanges'
import { isMarkdownFile } from '@/lib/fileClassification'
import type { CodeNode } from '@/types/nodes'
import { getNodeFlags, nodeFocusRing } from './nodeUtils'
import { registerEditorView, unregisterEditorView } from './codeNodeRegistry'
import { useCanvasStore } from '@/store/canvas'
import { REF_HEIGHT } from './ImportRefNode'
import { useGitStore } from '@/store/git'
import { useReviewStore } from '@/store/review'
import { samePath, toRepoRelative } from '@/lib/repoPath'
import { isDemoMode } from '@/lib/demoMode'
import MarkdownPreview from './MarkdownPreview'

import {
  MIN_CODE_NODE_WIDTH,
  CODE_NODE_HEIGHT_RESERVED,
  CM_PAD_TOP,
  HUNK_BTN_H,
} from './codeNode/constants'
import { computeRefLineLayouts } from './codeNode/refLineLayout'
import { buildEditorExtensions } from './codeNode/editorExtensions'
import type { InlineImportMap } from './codeNode/importClick'
import { lineWrapExtension } from './codeNode/editorTheme'
import { CodeNodeSkeleton } from './codeNode/CodeNodeSkeleton'
import { CodeNodeHeader } from './codeNode/CodeNodeHeader'
import { Minimap, type MinimapStripe } from './codeNode/Minimap'
import { RightSideRefPills } from './codeNode/RefPills'
import { HunkReviewLayer, type CommentDraft } from './codeNode/HunkReviewLayer'
import { useReviewTarget, type HunkDisplay } from './codeNode/useReviewTarget'
import { useAutoSave } from './codeNode/useAutoSave'
import { useHeadContent } from './codeNode/useHeadContent'

// How long the editor must stay mounted before the merge diff is computed.
// Long enough that key-repeat navigation unmounts the editor first, short
// enough to be imperceptible once the user actually lands on a file.
const MERGE_APPLY_DWELL_MS = 80

export default memo(function CodeNode({ data }: NodeProps<CodeNode>) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const mergeCompartmentRef = useRef<Compartment>(new Compartment())
  const wrapCompartmentRef = useRef<Compartment>(new Compartment())
  const readOnlyCompartmentRef = useRef<Compartment>(new Compartment())
  // Last mounted file + scroll offset, so an in-place reload (external change)
  // restores the reading position instead of jumping to the top.
  const mountedDocRef = useRef<{ filePath: string; scrollTop: number } | null>(null)
  const scrollHandlerRef = useRef<{ scrollDOM: HTMLElement; handler: () => void } | null>(null)
  const resizeObRef = useRef<ResizeObserver | null>(null)
  const flags = getNodeFlags(data)

  const [commentDraft, setCommentDraft] = useState<CommentDraft | null>(null)
  const [commentBody, setCommentBody] = useState('')
  const commentDraftRef = useRef(commentDraft)
  commentDraftRef.current = commentDraft

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
  const hunkLayerRef = useRef<HTMLDivElement>(null)
  const hunkDisplaysRef = useRef<HunkDisplay[]>([])
  const positionHunksRef = useRef<() => void>(() => {})

  const [geometryVer, setGeometryVer] = useState(0)
  // CodeMirror reports geometryChanged on every keystroke and scroll-measure;
  // coalesce to one React render per frame so typing isn't paced by the
  // position/stripe recompute cascade.
  const geometryRafRef = useRef<number | null>(null)
  const bumpGeometry = useCallback(() => {
    if (geometryRafRef.current !== null) return
    geometryRafRef.current = requestAnimationFrame(() => {
      geometryRafRef.current = null
      setGeometryVer((v) => v + 1)
    })
  }, [])
  const [pinnedStripePos, setPinnedStripePos] = useState<number | null>(null)
  const [linePositions, setLinePositions] = useState<Map<number, number>>(new Map())
  // Tracks the headContent value that linePositions was measured against. Pills
  // wait until this matches the current headContent so they never render at
  // pre-merge coordinates after the diff blocks are applied.
  const [positionsHeadContent, setPositionsHeadContent] = useState<string | null | undefined>(
    undefined,
  )
  const [minimapStripes, setMinimapStripes] = useState<MinimapStripe[]>([])
  // Hunks derived from the editor's own merge diff — the working-tree fallback
  // when there is no formal review session supplying hunks.
  const [mergeHunks, setMergeHunks] = useState<{ startLine: number; endLine: number }[]>([])
  // The HEAD text the merge compartment has actually applied. Diffing a large
  // file blocks for hundreds of ms, so the editor mounts plain and the merge
  // extension lands after first paint — this lags headContent until then, and
  // diff-derived UI (pills, hunks, stripes) keys off it rather than the prop.
  const [mergedHead, setMergedHead] = useState<string | null>(null)
  const mergedHeadRef = useRef<string | null>(null)

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
  const inlineImportsRef = useRef<InlineImportMap | null>(null)
  inlineImportsRef.current = inlineImports

  const hasHeadOverride = data.headOverride !== undefined
  // Commit/range-diff snapshots can never be edited. Working files open locked
  // too: this is a review tool and agents may be writing the same files
  // concurrently, so editing is an explicit per-node opt-in.
  const isPermanentReadOnly = data.readOnly === true
  const [editUnlocked, setEditUnlocked] = useState(false)
  const isReadOnly = isPermanentReadOnly || !editUnlocked
  const isReadOnlyRef = useRef(isReadOnly)
  isReadOnlyRef.current = isReadOnly
  // A "file changed on disk under a dirty buffer" decision is pending; all
  // saving is suspended until the user picks a side, so a stale autosave can
  // never clobber the newer external write.
  const [externalChange, setExternalChange] = useState(false)
  const externalChangeRef = useRef(externalChange)
  externalChangeRef.current = externalChange

  const gitStatus = useGitStore((s) => s.status)
  const repoPath = useGitStore((s) => s.repoPath)
  const loadHeadContent = useGitStore((s) => s.loadHeadContent)

  const gitEntry = useMemo(() => {
    if (hasHeadOverride || !gitStatus) return null
    return gitStatus.files.find((f) => samePath(data.filePath, f.path, repoPath)) ?? null
  }, [hasHeadOverride, gitStatus, data.filePath, repoPath])
  const isNewFile = gitEntry?.status === 'A' || gitEntry?.status === 'U'

  // `undefined` means "not yet determined"; the merge extension treats it as
  // null but pill rendering waits on it so they don't appear before the
  // editor's diff blocks have been applied.
  const headContent = useHeadContent({
    filePath: data.filePath,
    repoPath,
    headOverride: data.headOverride,
    hasHeadOverride,
    gitEntry,
    isNewFile,
    loadHeadContent,
  })
  const { reviewFilePath, fileComments, hunkDisplays, ensureReviewSession } = useReviewTarget({
    filePath: data.filePath,
    repoPath,
    hasGitChanges: !!gitEntry,
    dataReviewFilePath: data.review?.filePath,
    mergeHunks,
  })
  hunkDisplaysRef.current = hunkDisplays

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
    if (isReadOnlyRef.current || externalChangeRef.current) return false
    if (isDemoMode()) {
      setDirty(false)
      return true
    }
    setSaving(true)
    try {
      const platform = getPlatform()
      const newContent = view.state.doc.toString()
      markSelfWrite(data.filePath)
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

  useAutoSave({ isReadOnly, dirtyRef, suspendedRef: externalChangeRef, saveToFile })

  // External (agent) writes to this file: a clean buffer reloads in place; a
  // dirty buffer keeps the user's text and asks via the banner below.
  useEffect(() => {
    if (isPermanentReadOnly) return
    return onExternalFileChange(data.filePath, () => {
      if (dirtyRef.current) setExternalChange(true)
      else void useCanvasStore.getState().reloadFileColumn(data.filePath)
    })
  }, [data.filePath, isPermanentReadOnly])

  // Re-locking flushes pending edits so "locked" always means "saved".
  const handleToggleUnlocked = useCallback(() => {
    if (editUnlocked && dirtyRef.current) void saveToFileRef.current()
    setEditUnlocked(!editUnlocked)
  }, [editUnlocked])

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
      readOnlyCompartmentRef.current = new Compartment()

      const state = EditorState.create({
        doc: data.code,
        extensions: buildEditorExtensions({
          filePath: data.filePath,
          startLine: data.startLine,
          // Mount with an *identity* merge (original = the doc itself, zero
          // chunks, ~free to diff) rather than the real HEAD: diffing a large
          // file blocks first paint for hundreds of ms, so the deferred effect
          // below applies the real diff post-paint. The identity merge still
          // registers the 4px change gutter, so the reconfigure later doesn't
          // shift the code sideways.
          mergeExt: mergeCompartmentRef.current.of(buildMergeExtension(data.code)),
          wrapExt: wrapCompartmentRef.current.of(lineWrap ? lineWrapExtension : []),
          readOnlyExt: readOnlyCompartmentRef.current.of(
            isReadOnlyRef.current ? EditorState.readOnly.of(true) : [],
          ),
          onSave: () => void saveToFileRef.current(),
          onDocChanged: () => setDirty(true),
          onFocusChange: (hasFocus) => {
            setEditorFocused(hasFocus)
            if (!hasFocus && dirtyRef.current) void saveToFileRef.current()
          },
          onGeometryChange: bumpGeometry,
          getInlineImports: () => inlineImportsRef.current,
          onOpenImport: (item) =>
            void useCanvasStore.getState().focusFileByPath(item.resolvedPath, item.targetLine),
        }),
      })

      const view = new EditorView({ state, parent: container })
      // The first paint otherwise uses estimated line heights, so the gutter
      // renders compressed and visibly snaps once the async measure cycle
      // runs. Measuring synchronously aligns it before the browser paints.
      // measure(flush) is documented EditorView API but missing from this
      // version's typings.
      ;(view as EditorView & { measure: (flush?: boolean) => void }).measure()
      viewRef.current = view
      registerEditorView(view)
      mergedHeadRef.current = null
      setMergedHead(null)
      setEditorReady(true)
      setPreviewReady(true)
      setGeometryVer((v) => v + 1)

      const scrollDOM = view.scrollDOM
      // Same file remounting (in-place reload after an external change) keeps
      // its reading position; a different file starts at the top.
      if (mountedDocRef.current?.filePath === data.filePath) {
        scrollDOM.scrollTop = mountedDocRef.current.scrollTop
      }
      mountedDocRef.current = { filePath: data.filePath, scrollTop: scrollDOM.scrollTop }
      const handleEditorScroll = () => {
        if (mountedDocRef.current) mountedDocRef.current.scrollTop = scrollDOM.scrollTop
        const ty = `translateY(${-scrollDOM.scrollTop}px)`
        if (refOverlayRef.current) refOverlayRef.current.style.transform = ty
        positionHunksRef.current()
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
      if (geometryRafRef.current !== null) {
        cancelAnimationFrame(geometryRafRef.current)
        geometryRafRef.current = null
      }
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

  // Lock/unlock without rebuilding the editor.
  useEffect(() => {
    if (!editorReady) return
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure(
        isReadOnly ? EditorState.readOnly.of(true) : [],
      ),
    })
  }, [isReadOnly, editorReady])

  // Apply the merge diff after paint. rAF fires *before* paint, so nest a
  // timeout inside it — the dispatch (which computes the diff, up to hundreds
  // of ms for a large modified file) runs with the plain editor already on
  // screen. The dwell means rapid node-to-node scanning unmounts the editor
  // (cancelling via the cleanup) before the diff cost is ever paid.
  useEffect(() => {
    if (!editorReady || headContent === undefined) return
    const view = viewRef.current
    if (!view || headContent === mergedHeadRef.current) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const rafId = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        if (viewRef.current !== view) return
        // A null HEAD (no diff) falls back to an identity merge of the current
        // doc instead of removing the extension — dropping it would unregister
        // the change gutter and shift the code left.
        view.dispatch({
          effects: mergeCompartmentRef.current.reconfigure(
            buildMergeExtension(headContent ?? view.state.doc.toString()),
          ),
        })
        mergedHeadRef.current = headContent
        setMergedHead(headContent)
      }, MERGE_APPLY_DWELL_MS)
    })
    return () => {
      cancelAnimationFrame(rafId)
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [headContent, editorReady])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: wrapCompartmentRef.current.reconfigure(lineWrap ? lineWrapExtension : []),
    })
  }, [lineWrap])

  // Push comment highlights into the editor; clear them when nothing is under review.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: setCommentRanges.of(
        reviewFilePath ? fileComments.map((c) => ({ from: c.startLine, to: c.endLine })) : [],
      ),
    })
  }, [reviewFilePath, fileComments, editorReady])

  // Clamp each hunk's buttons (and the open comment input) to the top of its
  // visible region. Positions are read from the line's actual rendered rect
  // (coordsAtPos) relative to the overlay layer's own box, so there are no
  // padding/origin assumptions to drift. `top` is owned imperatively (never via
  // JSX style) so unrelated re-renders can't reset the buttons to 0 and pile
  // them up. Imperative so scrolling doesn't re-render.
  const positionHunks = useCallback(() => {
    const view = viewRef.current
    const layer = hunkLayerRef.current
    if (!view || !layer) return
    const doc = view.state.doc
    const layerTop = layer.getBoundingClientRect().top
    const viewH = layer.clientHeight

    // Hunk start_line includes leading diff context; anchor the buttons to the
    // first line that's actually changed (a merge chunk start within the hunk).
    const changedStarts = (getChunks(view.state)?.chunks ?? [])
      .map((c) => doc.lineAt(Math.min(c.fromB, doc.length)).number)
      .sort((a, b) => a - b)
    const anchorLine = (s: number, e: number) => {
      for (const ln of changedStarts) if (ln >= s && ln <= e) return ln
      return s
    }

    // coordsAtPos can throw ("No tile at position") when called mid-scroll,
    // before the view has measured tiles for the target region. Treat that the
    // same as an out-of-range position (null) so a fast scroll never crashes.
    const coordsAt = (pos: number) => {
      try {
        return view.coordsAtPos(pos)
      } catch {
        return null
      }
    }

    const place = (el: HTMLElement, startLine: number, endLine: number, extra: number) => {
      const s = Math.max(1, Math.min(anchorLine(startLine, endLine), doc.lines))
      const e = Math.max(s, Math.min(endLine, doc.lines))
      const sc = coordsAt(doc.line(s).from)
      const ec = coordsAt(doc.line(e).from)
      // ±Infinity when a boundary line is scrolled out of the rendered range.
      let top = -Infinity
      if (sc) {
        top = sc.top - layerTop
        // A modification renders its deleted lines as a block widget above the
        // first changed line; the line-above's bottom is that block's top, so
        // pull the anchor up to sit at the visible top of the change.
        if (s > 1) {
          const pc = coordsAt(doc.line(s - 1).from)
          if (pc) top = Math.min(top, pc.bottom - layerTop)
        }
        // Float the controls a line higher so they sit in the margin above the
        // hunk rather than covering its opening line. Clamped to 0 below, so a
        // hunk at the very top keeps its controls in view.
        top -= view.defaultLineHeight
      }
      const bottom = ec ? ec.bottom - layerTop : Infinity
      const visible = (!!sc || !!ec) && bottom > 0 && top < viewH
      el.style.display = visible ? '' : 'none'
      if (!visible) return
      const vp = Math.min(Math.max(0, top), Math.max(0, bottom - HUNK_BTN_H))
      el.style.top = `${vp + extra}px`
    }
    for (const h of hunkDisplaysRef.current) {
      const el = layer.querySelector(`[data-hunk="${h.startLine}"]`)
      if (el instanceof HTMLElement) place(el, h.startLine, h.endLine, 0)
    }
    const cd = commentDraftRef.current
    if (cd) {
      const cEl = layer.querySelector('[data-hunk-comment]')
      if (cEl instanceof HTMLElement) place(cEl, cd.startLine, cd.endLine, HUNK_BTN_H + 2)
    }
  }, [])
  positionHunksRef.current = positionHunks

  useLayoutEffect(() => {
    positionHunks()
  }, [positionHunks, hunkDisplays, commentDraft, geometryVer, editorHeight, mergedHead])

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
    if (!view || !rightSideLayout) {
      setLinePositions(new Map())
      return
    }
    // Use requestMeasure so we read line tops during CodeMirror's DOM-read
    // phase, when heights are guaranteed measured (not still estimates from
    // the initial HeightMap). Synchronous lineBlockAt right after `new
    // EditorView` can return estimate-based tops that shift once CM does
    // its first measure pass.
    let cancelled = false
    // Tag positions with the head the merge compartment had applied when this
    // measurement was scheduled (not the prop, which can run ahead of the
    // deferred apply) — pillsReady only trusts positions measured against the
    // layout that actually includes the diff blocks.
    const headContentAtRequest = mergedHead
    view.requestMeasure({
      key: 'codeNode-linePositions',
      read: (v) => {
        const positions = new Map<number, number>()
        const maxLine = v.state.doc.lines
        const lastBlock = v.lineBlockAt(v.state.doc.line(maxLine).from)
        const beyondTop = lastBlock.top + lastBlock.height
        const allLines = new Set<number>([...(rightSideLayout?.keys() ?? [])])
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
        setLinePositions((prev) => {
          if (prev.size !== positions.size) return positions
          for (const [line, top] of positions) {
            if (prev.get(line) !== top) return positions
          }
          return prev
        })
        setPositionsHeadContent(headContentAtRequest)
      },
    })
    return () => {
      cancelled = true
    }
  }, [rightSideLayout, geometryVer, mergedHead])

  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view) {
      setMinimapStripes([])
      setMergeHunks([])
      return
    }
    const result = getChunks(view.state)
    if (!result || result.chunks.length === 0) {
      setMinimapStripes([])
      setMergeHunks([])
      return
    }
    const totalLines = view.state.doc.lines
    if (totalLines === 0) {
      setMinimapStripes([])
      setMergeHunks([])
      return
    }
    const lineOf = (pos: number) =>
      view.state.doc.lineAt(Math.min(pos, view.state.doc.length)).number
    const stripes = result.chunks.map((chunk) => {
      const startLine = lineOf(chunk.fromB)
      const endLine = lineOf(Math.max(chunk.toB - 1, chunk.fromB))
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
    // Bail to the previous arrays when nothing moved — geometry changes fire
    // far more often than chunks actually shift, and a fresh identity here
    // re-renders the whole node.
    setMinimapStripes((prev) =>
      prev.length === stripes.length &&
      prev.every(
        (p, i) =>
          p.startFrac === stripes[i].startFrac &&
          p.endFrac === stripes[i].endFrac &&
          p.color === stripes[i].color &&
          p.fromPos === stripes[i].fromPos,
      )
        ? prev
        : stripes,
    )
    const hunks = result.chunks.map((chunk) => ({
      startLine: lineOf(chunk.fromB),
      endLine: lineOf(Math.max(chunk.toB - 1, chunk.fromB)),
    }))
    setMergeHunks((prev) =>
      prev.length === hunks.length &&
      prev.every((p, i) => p.startLine === hunks[i].startLine && p.endLine === hunks[i].endLine)
        ? prev
        : hunks,
    )
  }, [geometryVer, mergedHead])

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
  // has been resolved, the deferred merge apply has landed for it, and
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

  const handleToggleMdPreview = () => {
    if (!mdPreview && viewRef.current) {
      setMdContent(viewRef.current.state.doc.toString())
    }
    setMdPreview((v) => {
      useCanvasStore.setState({ mdPreviewEnabled: !v })
      return !v
    })
  }

  const handleStripeClick = (fromPos: number) => {
    viewRef.current?.dispatch({
      effects: EditorView.scrollIntoView(fromPos, { y: 'center' }),
    })
    setPinnedStripePos((p) => (p === fromPos ? null : fromPos))
  }

  const handleAcceptHunk = (h: HunkDisplay) => {
    if (!reviewFilePath) return
    ensureReviewSession()
    const rs = useReviewStore.getState()
    if (h.state === 'accepted') rs.unacceptHunk(reviewFilePath, h.startLine)
    else rs.acceptHunk(reviewFilePath, h.startLine)
  }

  const handleCommentHunk = (h: HunkDisplay) => {
    const view = viewRef.current
    if (!view) return
    const doc = view.state.doc
    const safeStart = Math.max(1, Math.min(h.startLine, doc.lines))
    const safeEnd = Math.max(safeStart, Math.min(h.endLine, doc.lines))
    const snippet = view.state.sliceDoc(doc.line(safeStart).from, doc.line(safeEnd).to)
    // Re-opening a hunk that's already commented edits the existing comment in
    // place rather than adding a duplicate.
    const existing = fileComments.find((c) => c.startLine === h.startLine)
    setCommentDraft({
      startLine: h.startLine,
      endLine: h.endLine,
      snippet,
      editingId: existing?.id,
    })
    setCommentBody(existing?.body ?? '')
  }

  const handleSubmitComment = () => {
    if (commentDraft && reviewFilePath) {
      ensureReviewSession()
      const rs = useReviewStore.getState()
      if (commentDraft.editingId) {
        rs.updateComment(commentDraft.editingId, commentBody.trim())
      } else {
        rs.addComment(
          reviewFilePath,
          commentDraft.startLine,
          commentDraft.endLine,
          commentDraft.snippet,
          commentBody.trim(),
        )
      }
    }
    setCommentDraft(null)
    setCommentBody('')
  }

  const handleCancelComment = () => {
    setCommentDraft(null)
    setCommentBody('')
  }

  return (
    <div
      className={`relative pointer-events-auto bg-background border border-r-0 rounded-l-lg nodrag nopan ${flags.isFocused ? nodeFocusRing(true, 'bordered') : 'border-border'} ${editorFocused ? 'border-primary/30' : ''} ${flags.isHidden ? 'opacity-30' : ''}`}
      style={{ width: nodeWidth }}
    >
      <CodeNodeHeader
        displayPath={displayPath}
        dirPrefix={dirPrefix}
        fileName={fileName}
        isMd={isMd}
        mdPreview={mdPreview}
        onToggleMdPreview={handleToggleMdPreview}
        commitHash={data.commitHash}
        isNewFile={isNewFile && !isPermanentReadOnly}
        isReadOnly={isReadOnly}
        dirty={dirty}
        saving={saving}
        editorFocused={editorFocused}
        lineCount={lineCount}
        lineWrap={lineWrap}
        onToggleLineWrap={() => setLineWrap((v) => !v)}
        canUnlock={!isPermanentReadOnly}
        unlocked={editUnlocked}
        onToggleUnlocked={handleToggleUnlocked}
      />

      {externalChange && (
        <div className="flex items-center justify-between gap-2 px-3 py-1 text-[11px] bg-yellow-900/30 text-yellow-300 border-b border-yellow-700/40">
          <span className="truncate">Changed on disk, your unsaved edits are stale</span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              className="px-1.5 py-0.5 rounded bg-yellow-700/40 hover:bg-yellow-700/60 cursor-pointer"
              onClick={() => {
                setExternalChange(false)
                setDirty(false)
                void useCanvasStore.getState().reloadFileColumn(data.filePath)
              }}
            >
              Load new version
            </button>
            <button
              type="button"
              className="px-1.5 py-0.5 rounded hover:bg-muted/50 cursor-pointer"
              onClick={() => setExternalChange(false)}
              title="Keep the buffer; saving resumes and will overwrite the on-disk version"
            >
              Keep my edits
            </button>
          </div>
        </div>
      )}

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
          {reviewFilePath && editorReady && hunkDisplays.length > 0 && (
            <HunkReviewLayer
              layerRef={hunkLayerRef}
              hunkDisplays={hunkDisplays}
              onAccept={handleAcceptHunk}
              onComment={handleCommentHunk}
              commentDraft={commentDraft}
              commentBody={commentBody}
              onCommentBodyChange={setCommentBody}
              onCancelComment={handleCancelComment}
              onSubmitComment={handleSubmitComment}
            />
          )}
        </div>
        {/* Reserve the minimap column as soon as a diff source is known (git
            entry / commit override) — stripes land after the deferred merge,
            and mounting the column only then would jolt the editor's width. */}
        {!mdPreview &&
          !data.hideMinimap &&
          editorHeight > 0 &&
          (gitEntry !== null || hasHeadOverride || minimapStripes.length > 0) && (
            <Minimap
              stripes={minimapStripes}
              editorHeight={editorHeight}
              pinnedPos={pinnedStripePos}
              onStripeClick={handleStripeClick}
            />
          )}
        {!mdPreview && rightSideLayout && pillsReady && (
          <RightSideRefPills
            overlayRef={refOverlayRef}
            rightSideLayout={rightSideLayout}
            linePositions={linePositions}
            overlayHeight={overlayHeight}
          />
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
