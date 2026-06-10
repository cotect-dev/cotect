import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { Compartment, EditorState } from '@codemirror/state'
import { buildEditorExtensions } from '@/components/Canvas/nodes/codeNode/editorExtensions'
import {
  buildMergeExtension,
  getChunks,
  setCommentRanges,
} from '@/components/Canvas/nodes/cmPlugins'
import { CodeNodeHeader } from '@/components/Canvas/nodes/codeNode/CodeNodeHeader'
import {
  HunkReviewLayer,
  type CommentDraft,
} from '@/components/Canvas/nodes/codeNode/HunkReviewLayer'
import { Minimap, type MinimapStripe } from '@/components/Canvas/nodes/codeNode/Minimap'
import { HUNK_BTN_H } from '@/components/Canvas/nodes/codeNode/constants'
import type { HunkDisplay } from '@/components/Canvas/nodes/codeNode/useReviewTarget'
import { DEMO_AGENT, DEMO_FILE_PATH, DEMO_HEAD } from '../demoCode'

type Hunk = { startLine: number; endLine: number }
type HunkState = HunkDisplay['state']

const sameHunks = (a: Hunk[], b: Hunk[]) =>
  a.length === b.length &&
  a.every((h, i) => h.startLine === b[i].startLine && h.endLine === b[i].endLine)

const sameStripes = (a: MinimapStripe[], b: MinimapStripe[]) =>
  a.length === b.length &&
  a.every(
    (s, i) =>
      s.startFrac === b[i].startFrac &&
      s.endFrac === b[i].endFrac &&
      s.color === b[i].color &&
      s.fromPos === b[i].fromPos,
  )

/** The real cotect review editor — same components the desktop app mounts —
 *  wired to an in-memory "HEAD vs agent change" instead of a git repo. */
export function LiveReviewDemo() {
  // Unlocked editing lets visitors mangle the document; a remount key gives
  // them a way back to the scripted diff.
  const [generation, setGeneration] = useState(0)
  return <DemoCard key={generation} onReset={() => setGeneration((g) => g + 1)} />
}

function DemoCard({ onReset }: { onReset: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const hunkLayerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)

  const [readOnlyComp] = useState(() => new Compartment())
  const [wrapComp] = useState(() => new Compartment())
  const [mergeComp] = useState(() => new Compartment())

  const [hunks, setHunks] = useState<Hunk[]>([])
  const [hunkStates, setHunkStates] = useState<Record<number, HunkState>>({})
  const [comments, setComments] = useState<Record<number, string>>({})
  const [commentDraft, setCommentDraft] = useState<CommentDraft | null>(null)
  const [commentBody, setCommentBody] = useState('')
  const [stripes, setStripes] = useState<MinimapStripe[]>([])
  const [pinnedPos, setPinnedPos] = useState<number | null>(null)
  const [editorHeight, setEditorHeight] = useState(0)
  const [unlocked, setUnlocked] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [focused, setFocused] = useState(false)
  const [lineWrap, setLineWrap] = useState(false)
  const [lineCount, setLineCount] = useState(DEMO_AGENT.split('\n').length - 1)

  const hunkDisplays = useMemo<HunkDisplay[]>(
    () =>
      hunks.map((h) => ({
        startLine: h.startLine,
        endLine: h.endLine,
        state: hunkStates[h.startLine] ?? 'none',
      })),
    [hunks, hunkStates],
  )
  // Mirrored into refs (before the positioning layout effect below) so the
  // imperative scroll/measure path reads fresh values without re-binding.
  const hunkDisplaysRef = useRef(hunkDisplays)
  const commentDraftRef = useRef(commentDraft)
  useLayoutEffect(() => {
    hunkDisplaysRef.current = hunkDisplays
    commentDraftRef.current = commentDraft
  }, [hunkDisplays, commentDraft])

  // Same placement strategy as CodeNode: read each hunk's rendered rect via
  // coordsAtPos and clamp its buttons to the visible part, imperatively so
  // scrolling never re-renders React.
  const positionHunks = useCallback(() => {
    const view = viewRef.current
    const layer = hunkLayerRef.current
    if (!view || !layer) return
    const doc = view.state.doc
    const layerTop = layer.getBoundingClientRect().top
    const viewH = layer.clientHeight
    const coordsAt = (pos: number) => {
      try {
        return view.coordsAtPos(pos)
      } catch {
        return null
      }
    }
    const place = (el: HTMLElement, startLine: number, endLine: number, extra: number) => {
      const s = Math.max(1, Math.min(startLine, doc.lines))
      const e = Math.max(s, Math.min(endLine, doc.lines))
      const sc = coordsAt(doc.line(s).from)
      const ec = coordsAt(doc.line(e).from)
      let top = -Infinity
      if (sc) {
        top = sc.top - layerTop
        // Deleted lines render as a block widget above the first changed line;
        // anchor at its visible top, not below it.
        if (s > 1) {
          const pc = coordsAt(doc.line(s - 1).from)
          if (pc) top = Math.min(top, pc.bottom - layerTop)
        }
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
      const el = layer.querySelector('[data-hunk-comment]')
      if (el instanceof HTMLElement) place(el, cd.startLine, cd.endLine, HUNK_BTN_H + 2)
    }
  }, [])

  const measure = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    const chunks = getChunks(view.state)?.chunks ?? []
    const doc = view.state.doc
    const totalLines = doc.lines
    const lineOf = (pos: number) => doc.lineAt(Math.min(pos, doc.length)).number
    const nextHunks = chunks.map((c) => ({
      startLine: lineOf(c.fromB),
      endLine: lineOf(Math.max(c.toB - 1, c.fromB)),
    }))
    setHunks((prev) => (sameHunks(prev, nextHunks) ? prev : nextHunks))
    const nextStripes = chunks.map((c) => {
      const startLine = lineOf(c.fromB)
      const endLine = lineOf(Math.max(c.toB - 1, c.fromB))
      const isDelete = c.fromB === c.toB
      const isInsert = c.fromA === c.toA
      return {
        startFrac: (startLine - 1) / totalLines,
        endFrac: Math.min(endLine / totalLines, 1),
        color: isDelete ? '#dc2626' : isInsert ? '#22c55e' : '#3b82f6',
        fromPos: c.fromB,
      }
    })
    setStripes((prev) => (sameStripes(prev, nextStripes) ? prev : nextStripes))
    setLineCount(totalLines)
    positionHunks()
  }, [positionHunks])

  const scheduleMeasure = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      measure()
    })
  }, [measure])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const view = new EditorView({
      state: EditorState.create({
        doc: DEMO_AGENT,
        extensions: buildEditorExtensions({
          filePath: DEMO_FILE_PATH,
          startLine: 1,
          mergeExt: mergeComp.of(buildMergeExtension(DEMO_HEAD)),
          wrapExt: wrapComp.of([]),
          readOnlyExt: readOnlyComp.of(EditorState.readOnly.of(true)),
          onSave: () => {},
          onDocChanged: () => {
            setDirty(true)
            scheduleMeasure()
          },
          onFocusChange: setFocused,
          onGeometryChange: scheduleMeasure,
          getInlineImports: () => null,
          onOpenImport: () => {},
        }),
      }),
      parent: host,
    })
    viewRef.current = view
    const scrollDOM = view.scrollDOM
    const onScroll = () => scheduleMeasure()
    scrollDOM.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(() => {
      setEditorHeight(scrollDOM.clientHeight)
      scheduleMeasure()
    })
    ro.observe(scrollDOM)
    setEditorHeight(scrollDOM.clientHeight)
    scheduleMeasure()
    return () => {
      ro.disconnect()
      scrollDOM.removeEventListener('scroll', onScroll)
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      view.destroy()
      viewRef.current = null
    }
  }, [mergeComp, wrapComp, readOnlyComp, scheduleMeasure])

  useLayoutEffect(() => {
    positionHunks()
  }, [positionHunks, hunkDisplays, commentDraft, editorHeight])

  // Commented hunks get the same yellow line tint the app paints during review.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: setCommentRanges.of(
        hunks
          .filter((h) => (hunkStates[h.startLine] ?? 'none') === 'commented')
          .map((h) => ({ from: h.startLine, to: h.endLine })),
      ),
    })
  }, [hunks, hunkStates])

  const handleAccept = (h: HunkDisplay) => {
    setHunkStates((s) => ({
      ...s,
      [h.startLine]: s[h.startLine] === 'accepted' ? 'none' : 'accepted',
    }))
    if (commentDraft?.startLine === h.startLine) setCommentDraft(null)
  }

  const handleComment = (h: HunkDisplay) => {
    setCommentBody(comments[h.startLine] ?? '')
    setCommentDraft({ startLine: h.startLine, endLine: h.endLine, snippet: '' })
  }

  const handleSubmitComment = () => {
    if (!commentDraft || !commentBody.trim()) return
    const start = commentDraft.startLine
    setComments((c) => ({ ...c, [start]: commentBody.trim() }))
    setHunkStates((s) => ({ ...s, [start]: 'commented' }))
    setCommentDraft(null)
    setCommentBody('')
  }

  const handleToggleUnlocked = () => {
    const view = viewRef.current
    if (!view) return
    const next = !unlocked
    setUnlocked(next)
    view.dispatch({ effects: readOnlyComp.reconfigure(EditorState.readOnly.of(!next)) })
  }

  const handleToggleLineWrap = () => {
    const view = viewRef.current
    if (!view) return
    const next = !lineWrap
    setLineWrap(next)
    view.dispatch({ effects: wrapComp.reconfigure(next ? EditorView.lineWrapping : []) })
  }

  const handleStripeClick = (fromPos: number) => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: EditorView.scrollIntoView(fromPos, { y: 'center' }) })
    setPinnedPos((p) => (p === fromPos ? null : fromPos))
  }

  const reviewed = hunkDisplays.filter((h) => h.state !== 'none').length
  const total = hunkDisplays.length

  return (
    <div className="demo-card rounded-lg border border-border bg-[#1e1e1e] shadow-2xl overflow-hidden">
      <CodeNodeHeader
        displayPath={DEMO_FILE_PATH}
        dirPrefix="src/net/"
        fileName="fetchWithRetry.ts"
        isMd={false}
        mdPreview={false}
        onToggleMdPreview={() => {}}
        isNewFile={false}
        isReadOnly={!unlocked}
        dirty={dirty}
        saving={false}
        editorFocused={focused}
        lineCount={lineCount}
        lineWrap={lineWrap}
        onToggleLineWrap={handleToggleLineWrap}
        canUnlock
        unlocked={unlocked}
        onToggleUnlocked={handleToggleUnlocked}
      />
      <div className="flex" style={{ height: 440 }}>
        <div className="relative flex-1 min-w-0">
          <div ref={hostRef} className="demo-editor-host absolute inset-0" />
          <HunkReviewLayer
            layerRef={hunkLayerRef}
            hunkDisplays={hunkDisplays}
            onAccept={handleAccept}
            onComment={handleComment}
            commentDraft={commentDraft}
            commentBody={commentBody}
            onCommentBodyChange={setCommentBody}
            onCancelComment={() => setCommentDraft(null)}
            onSubmitComment={handleSubmitComment}
          />
        </div>
        {editorHeight > 0 && stripes.length > 0 && (
          <Minimap
            stripes={stripes}
            editorHeight={editorHeight}
            pinnedPos={pinnedPos}
            onStripeClick={handleStripeClick}
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-border/50 bg-muted/30 font-mono text-[11px]">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={reviewed === total && total > 0 ? 'text-green-400' : 'text-muted-foreground'}
          >
            {reviewed}/{total} hunks reviewed
          </span>
          <div className="h-1 w-28 rounded-full bg-border overflow-hidden">
            <div
              className="h-full rounded-full bg-green-500 transition-all duration-300"
              style={{ width: total > 0 ? `${(reviewed / total) * 100}%` : '0%' }}
            />
          </div>
          {reviewed === total && total > 0 && (
            <span className="text-green-400">✓ ready to ship</span>
          )}
        </div>
        <button
          type="button"
          onClick={onReset}
          className="shrink-0 text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
        >
          ↺ reset demo
        </button>
      </div>
    </div>
  )
}
