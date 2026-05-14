import { EditorView, ViewPlugin, Decoration, type DecorationSet } from '@codemirror/view'
import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { unifiedMergeView, getChunks } from '@codemirror/merge'
import { showMinimap } from '@replit/codemirror-minimap'

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

export function buildMergeExtension(
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

export function buildMinimapGutters(view: EditorView): Record<number, string> {
  const result = getChunks(view.state)
  if (!result || result.chunks.length === 0) return {}
  const gutters: Record<number, string> = {}
  const doc = view.state.doc
  for (const chunk of result.chunks) {
    if (chunk.fromB < chunk.toB) {
      const startLine = doc.lineAt(chunk.fromB).number
      const endLine = doc.lineAt(Math.min(chunk.toB - 1, doc.length)).number
      for (let l = startLine; l <= endLine; l++) gutters[l] = 'rgba(80,200,100,0.7)'
    }
    if (chunk.fromA < chunk.toA && !(chunk.fromB < chunk.toB)) {
      const line = doc.lineAt(Math.min(chunk.fromB, doc.length)).number
      gutters[line] = 'rgba(220,60,50,0.7)'
    }
  }
  return gutters
}

export const MINIMAP_WIDTH = 60

export function createMinimapConfig(gutters: Record<number, string>[] = [{}]) {
  return {
    create: () => {
      const dom = document.createElement('div')
      dom.style.cssText = `width:${MINIMAP_WIDTH}px;`
      return { dom }
    },
    displayText: 'blocks' as const,
    showOverlay: 'always' as const,
    gutters,
  }
}

export function createMinimapExtension(gutters: Record<number, string>[] = [{}]) {
  return showMinimap.of(createMinimapConfig(gutters))
}
