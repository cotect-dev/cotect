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
import { RangeSet, RangeSetBuilder, StateField, type Extension } from '@codemirror/state'
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
