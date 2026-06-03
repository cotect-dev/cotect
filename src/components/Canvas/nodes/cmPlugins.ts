import {
  EditorView,
  ViewPlugin,
  Decoration,
  type DecorationSet,
  gutter,
  GutterMarker,
  gutterLineClass,
  lineNumberWidgetMarker,
  type WidgetType,
} from '@codemirror/view'
import {
  RangeSet,
  RangeSetBuilder,
  StateField,
  StateEffect,
  type Extension,
  type Range,
} from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { unifiedMergeView, getChunks, acceptChunk, rejectChunk } from '@codemirror/merge'

export { getChunks, acceptChunk, rejectChunk }

const RAINBOW_COLORS = ['#ffd700', '#da70d6', '#179fff']

function buildRainbowDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const tree = syntaxTree(view.state)
  const stack: number[] = []
  const decos: { from: number; to: number; depth: number }[] = []

  tree.iterate({
    enter(node) {
      const name = node.name
      if (
        name === 'OpenBracket' ||
        name === 'OpenParen' ||
        name === 'OpenBrace' ||
        name === '(' ||
        name === '[' ||
        name === '{'
      ) {
        stack.push(decos.length)
        decos.push({ from: node.from, to: node.to, depth: stack.length - 1 })
        return
      }
      if (
        name === 'CloseBracket' ||
        name === 'CloseParen' ||
        name === 'CloseBrace' ||
        name === ')' ||
        name === ']' ||
        name === '}'
      ) {
        const depth = stack.length > 0 ? stack.pop()! : decos.length
        const d = decos[depth]?.depth ?? 0
        decos.push({ from: node.from, to: node.to, depth: d })
        return
      }
    },
  })

  if (decos.length === 0) {
    const doc = view.state.doc
    const openBrackets: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
    const closeBrackets = new Set([')', ']', '}'])
    const openStack: { depth: number }[] = []
    const collected: { from: number; to: number; depth: number }[] = []
    for (let i = 0; i < doc.length; i++) {
      const ch = doc.sliceString(i, i + 1)
      if (ch in openBrackets) {
        collected.push({ from: i, to: i + 1, depth: openStack.length })
        openStack.push({ depth: openStack.length })
      } else if (closeBrackets.has(ch)) {
        const d = openStack.length > 0 ? openStack.pop()!.depth : 0
        collected.push({ from: i, to: i + 1, depth: d })
      }
    }
    collected.sort((a, b) => a.from - b.from)
    for (const d of collected) {
      builder.add(
        d.from,
        d.to,
        Decoration.mark({
          attributes: { style: `color: ${RAINBOW_COLORS[d.depth % RAINBOW_COLORS.length]}` },
        }),
      )
    }
    return builder.finish()
  }

  decos.sort((a, b) => a.from - b.from)
  for (const d of decos) {
    builder.add(
      d.from,
      d.to,
      Decoration.mark({
        attributes: { style: `color: ${RAINBOW_COLORS[d.depth % RAINBOW_COLORS.length]}` },
      }),
    )
  }
  return builder.finish()
}

export const rainbowBrackets = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildRainbowDecorations(view)
    }
    update(update: { docChanged: boolean; view: EditorView; startState: { doc: unknown } }) {
      if (update.docChanged || update.startState.doc !== update.view.state.doc) {
        this.decorations = buildRainbowDecorations(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

class DeletionLineMarker extends GutterMarker {
  elementClass = 'cm-cotectDeletionLine'
  lineCount: number
  constructor(lineCount: number) {
    super()
    this.lineCount = lineCount
  }
  eq(other: GutterMarker): boolean {
    return other instanceof DeletionLineMarker && other.lineCount === this.lineCount
  }
  toDOM() {
    const container = document.createElement('div')
    container.className = 'cm-cotectDeletionLines'
    for (let i = 0; i < this.lineCount; i++) {
      const row = document.createElement('div')
      row.className = 'cm-cotectDeletionLineRow'
      row.textContent = '−'
      container.appendChild(row)
    }
    return container
  }
}

// DeletionWidget (from @codemirror/merge) is not exported; duck-type by its
// unique instance shape (buildDOM/dom set in its constructor).
function isDeletionWidget(widget: WidgetType): boolean {
  return (
    'buildDOM' in widget &&
    typeof (widget as unknown as { buildDOM: unknown }).buildDOM === 'function'
  )
}

function countDeletedLines(widget: WidgetType, view: EditorView): number {
  try {
    const dom = widget.toDOM(view)
    if (dom instanceof HTMLElement) {
      return Math.max(dom.querySelectorAll('.cm-deletedLine').length, 1)
    }
  } catch {
    /* fall through */
  }
  return 1
}

class ChangedLineGutterMarker extends GutterMarker {
  elementClass = 'cm-cotectChangedGutter'
}
const changedLineGutterMarker = new ChangedLineGutterMarker()

const changedLineGutterField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(_value, tr) {
    const chunks = getChunks(tr.state)
    if (!chunks) return RangeSet.empty
    const doc = tr.state.doc
    const builder = new RangeSetBuilder<GutterMarker>()
    for (const chunk of chunks.chunks) {
      if (chunk.fromB === chunk.toB) continue
      const startNo = doc.lineAt(Math.min(chunk.fromB, doc.length)).number
      const endNo = doc.lineAt(Math.min(Math.max(chunk.toB - 1, chunk.fromB), doc.length)).number
      for (let n = startNo; n <= endNo; n++) {
        const linePos = doc.line(n).from
        builder.add(linePos, linePos, changedLineGutterMarker)
      }
    }
    return builder.finish()
  },
  provide: (f) => gutterLineClass.from(f),
})

export function buildMergeExtension(head: string | null): Extension {
  if (head === null) return []
  return [
    unifiedMergeView({ original: head, mergeControls: false }),
    changedLineGutterField,
    lineNumberWidgetMarker.of((view, widget) =>
      isDeletionWidget(widget) ? new DeletionLineMarker(countDeletedLines(widget, view)) : null,
    ),
  ]
}

export const setCommentRanges = StateEffect.define<{ from: number; to: number }[]>()

const commentLineDeco = Decoration.line({ class: 'cm-cotectCommentLine' })

export const commentHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setCommentRanges)) {
        const maxLine = tr.state.doc.lines
        const ranges = e.value
          .map((r) => ({ from: Math.min(r.from, maxLine), to: Math.min(r.to, maxLine) }))
          .sort((a, b) => a.from - b.from)
        const decos: Range<Decoration>[] = []
        for (const r of ranges) {
          for (let ln = r.from; ln <= r.to; ln++) {
            decos.push(commentLineDeco.range(tr.state.doc.line(ln).from))
          }
        }
        deco = Decoration.set(decos, true)
      }
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

export const commentHighlightTheme: Extension = EditorView.theme({
  '.cm-cotectCommentLine': {
    backgroundColor: 'rgba(250, 204, 21, 0.10)',
    boxShadow: 'inset 2px 0 0 rgba(250, 204, 21, 0.6)',
  },
})

export type HunkDisplay = {
  startLine: number
  endLine: number
  state: 'none' | 'accepted' | 'commented'
}

export const setReviewHunks = StateEffect.define<HunkDisplay[]>()
export const openHunkActions = StateEffect.define<{ startLine: number; endLine: number }>()

export const reviewHunkField = StateField.define<HunkDisplay[]>({
  create() {
    return []
  },
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setReviewHunks)) return e.value
    return value
  },
})

class HunkMarker extends GutterMarker {
  readonly state: HunkDisplay['state']
  constructor(state: HunkDisplay['state']) {
    super()
    this.state = state
  }
  eq(other: HunkMarker) {
    return other.state === this.state
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = `cm-cotectHunkMark cm-cotectHunkMark-${this.state}`
    el.textContent = this.state === 'accepted' ? '✓' : this.state === 'commented' ? '💬' : '•'
    el.title = 'Review this hunk'
    return el
  }
}

export const reviewHunkGutter = gutter({
  class: 'cm-cotectHunkGutter',
  markers: (view) => {
    const hunks = view.state.field(reviewHunkField, false) ?? []
    const maxLine = view.state.doc.lines
    const marks = hunks
      .map((h) => ({
        pos: view.state.doc.line(Math.max(1, Math.min(h.startLine, maxLine))).from,
        state: h.state,
      }))
      .sort((a, b) => a.pos - b.pos)
      .map((m) => new HunkMarker(m.state).range(m.pos))
    return RangeSet.of(marks, true)
  },
  initialSpacer: () => new HunkMarker('none'),
  domEventHandlers: {
    mousedown(view, line) {
      const lineNo = view.state.doc.lineAt(line.from).number
      const hunks = view.state.field(reviewHunkField, false) ?? []
      const hunk = hunks.find((h) => h.startLine === lineNo)
      if (!hunk) return false
      view.dispatch({
        effects: openHunkActions.of({ startLine: hunk.startLine, endLine: hunk.endLine }),
      })
      return true
    },
  },
})

export const reviewHunkTheme: Extension = EditorView.theme({
  '.cm-cotectHunkGutter': {
    width: '16px',
    cursor: 'pointer',
  },
  '.cm-cotectHunkMark': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    width: '16px',
    opacity: '0.85',
  },
  '.cm-cotectHunkMark-none': { color: 'rgba(255,255,255,0.35)' },
  '.cm-cotectHunkMark-accepted': { color: '#22c55e' },
  '.cm-cotectHunkMark-commented': { color: '#fbbf24' },
})
