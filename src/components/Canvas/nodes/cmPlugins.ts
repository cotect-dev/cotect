import { EditorView, ViewPlugin, Decoration, type DecorationSet } from '@codemirror/view'
import { RangeSetBuilder, type Extension } from '@codemirror/state'
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

export function buildMergeExtension(head: string | null): Extension {
  if (head === null) return []
  return unifiedMergeView({ original: head, mergeControls: false })
}
