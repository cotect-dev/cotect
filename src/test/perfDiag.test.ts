// Temporary diagnostic benchmark — measures CodeNode editor mount costs in jsdom.
import { describe, it } from 'vitest'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Compartment } from '@codemirror/state'
import { buildEditorExtensions } from '@/components/Canvas/nodes/codeNode/editorExtensions'
import { buildMergeExtension, rainbowBrackets } from '@/components/Canvas/nodes/cmPlugins'

function makeDoc(lines: number): string {
  const out: string[] = []
  for (let i = 0; i < lines; i++) {
    out.push(
      `export function fn${i}(a: number, b: { x: string[]; y: Map<string, number> }): number {`,
      `  const arr = [a, b.y.get('k') ?? 0, (a + 1) * 2]`,
      `  return arr.reduce((s, v) => s + v, 0)`,
      `}`,
    )
  }
  return out.join('\n')
}

function baseOpts(mergeExt: Extension) {
  return {
    filePath: 'src/bench.ts',
    startLine: 1,
    mergeExt,
    wrapExt: new Compartment().of([]),
    readOnlyExt: new Compartment().of([]),
    onSave: () => {},
    onDocChanged: () => {},
    onFocusChange: () => {},
    onGeometryChange: () => {},
    getInlineImports: () => null,
    onOpenImport: () => {},
  }
}

function time(label: string, fn: () => void, runs = 3): number {
  // warm-up
  fn()
  let total = 0
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    fn()
    total += performance.now() - t0
  }
  const avg = total / runs
  console.log(`${label}: ${avg.toFixed(1)}ms`)
  return avg
}

function mount(doc: string, extensions: Extension): EditorView {
  const state = EditorState.create({ doc, extensions })
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({ state, parent })
  view.destroy()
  parent.remove()
  return view
}

describe('editor mount diagnostics', () => {
  it('profiles mount and edit costs', () => {
    for (const lines of [250, 1250]) {
      const doc = makeDoc(lines) // 4 source lines per `lines` unit
      console.log(`\n=== doc: ${lines * 4} lines, ${doc.length} chars ===`)

      const full = buildEditorExtensions(baseOpts(new Compartment().of([])))
      time('mount full stack (no merge)', () => mount(doc, full))

      const noRainbow = buildEditorExtensions(baseOpts(new Compartment().of([]))).filter(
        (e) => e !== rainbowBrackets,
      )
      time('mount minus rainbowBrackets', () => mount(doc, noRainbow))

      // merge against a modified head (every 50th line changed)
      const headLines = doc.split('\n')
      for (let i = 0; i < headLines.length; i += 50) headLines[i] = `// changed ${i}`
      const head = headLines.join('\n')
      const withMerge = buildEditorExtensions(
        baseOpts(new Compartment().of(buildMergeExtension(head))),
      )
      time('mount full + unified merge (modified head)', () => mount(doc, withMerge))

      // typing transaction cost
      const state = EditorState.create({ doc, extensions: full })
      const parent = document.createElement('div')
      document.body.appendChild(parent)
      const view = new EditorView({ state, parent })
      time(
        'single typing transaction (full stack)',
        () => view.dispatch({ changes: { from: 10, insert: 'x' } }),
        5,
      )
      view.destroy()
      parent.remove()

      const stateM = EditorState.create({
        doc,
        extensions: buildEditorExtensions(
          baseOpts(new Compartment().of(buildMergeExtension(head))),
        ),
      })
      const parentM = document.createElement('div')
      document.body.appendChild(parentM)
      const viewM = new EditorView({ state: stateM, parent: parentM })
      time(
        'single typing transaction (full + merge)',
        () => viewM.dispatch({ changes: { from: 10, insert: 'x' } }),
        5,
      )
      viewM.destroy()
      parentM.remove()
    }
  }, 120_000)
})
