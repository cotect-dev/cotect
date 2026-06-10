import { describe, it, expect } from 'vitest'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { buildEditorExtensions } from './editorExtensions'
import { buildMergeExtension } from '../cmPlugins'

function mount(mergeExt: ReturnType<Compartment['of']>) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({
    state: EditorState.create({
      doc: 'line one\nline two\nline three',
      extensions: buildEditorExtensions({
        filePath: 'src/a.ts',
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
      }),
    }),
    parent,
  })
  return { view, parent }
}

// The editor mounts with an identity merge (original = doc) precisely so the
// merge view's 4px change gutter exists from first paint; swapping in the real
// HEAD later must not add or remove gutters, or the code visibly shifts.
describe('merge change gutter layout stability', () => {
  it('identity merge registers the change gutter at mount', () => {
    const comp = new Compartment()
    const { view, parent } = mount(comp.of(buildMergeExtension('line one\nline two\nline three')))
    expect(view.dom.querySelector('.cm-gutter.cm-changeGutter')).not.toBeNull()
    view.destroy()
    parent.remove()
  })

  it('reconfiguring identity → real HEAD keeps the same gutter set', () => {
    const doc = 'line one\nline two\nline three'
    const comp = new Compartment()
    const { view, parent } = mount(comp.of(buildMergeExtension(doc)))
    const guttersBefore = view.dom.querySelectorAll('.cm-gutters .cm-gutter').length

    view.dispatch({
      effects: comp.reconfigure(buildMergeExtension('line one\nCHANGED\nline three')),
    })
    expect(view.dom.querySelectorAll('.cm-gutters .cm-gutter').length).toBe(guttersBefore)
    expect(view.dom.querySelector('.cm-gutter.cm-changeGutter')).not.toBeNull()

    // Reverting to a null HEAD goes back to an identity merge, never to "no
    // merge" — the gutter must survive that too.
    view.dispatch({
      effects: comp.reconfigure(buildMergeExtension(view.state.doc.toString())),
    })
    expect(view.dom.querySelectorAll('.cm-gutters .cm-gutter').length).toBe(guttersBefore)
    view.destroy()
    parent.remove()
  })
})
