import {
  EditorView,
  ViewPlugin,
  Decoration,
  type DecorationSet,
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
      return dom.querySelectorAll('.cm-deletedLine').length
    }
  } catch {
    /* fall through */
  }
  return 0
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

// The merge view defaults scanLimit to 500: once a scanned range has more than
// that many changed characters it abandons precise diffing and falls back to a
// coarse approximation that lumps identical lines into giant "changed" blocks.
// That wrecks diffs against an older baseline (large base↔tip edit distance), so
// raise the limit substantially and bound the worst case with a timeout.
const DIFF_CONFIG = { scanLimit: 50_000, timeout: 5_000 }

export function buildMergeExtension(head: string | null): Extension {
  if (head === null) return []
  return [
    unifiedMergeView({ original: head, mergeControls: false, diffConfig: DIFF_CONFIG }),
    changedLineGutterField,
    // A pure-addition region (a brand-new file, or an insertion-only hunk) has
    // no real deleted lines; skip the marker so no stray "−" overlaps the line
    // number.
    lineNumberWidgetMarker.of((view, widget) => {
      if (!isDeletionWidget(widget)) return null
      const count = countDeletedLines(widget, view)
      return count > 0 ? new DeletionLineMarker(count) : null
    }),
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
