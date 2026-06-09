import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { ImportRefItem } from '@/types/nodes'
import { resolveImportAtLine, setHoverLine, hoverLineField } from './importClick'

const item = (path: string): ImportRefItem => ({
  label: path,
  resolvedPath: path,
  kind: 'import',
  targetLine: 3,
})

describe('resolveImportAtLine', () => {
  it('returns the first import on a mapped line', () => {
    const map = new Map([[2, [item('src/a.ts'), item('src/b.ts')]]])
    expect(resolveImportAtLine(map, 2)?.resolvedPath).toBe('src/a.ts')
  })

  it('returns null for unmapped lines', () => {
    const map = new Map([[2, [item('src/a.ts')]]])
    expect(resolveImportAtLine(map, 5)).toBeNull()
  })

  it('returns null for a null map', () => {
    expect(resolveImportAtLine(null, 1)).toBeNull()
  })
})

describe('hoverLineField', () => {
  it('tracks the hovered line through setHoverLine effects', () => {
    let state = EditorState.create({ doc: 'a\nb\nc', extensions: [hoverLineField] })
    expect(state.field(hoverLineField)).toBeNull()
    state = state.update({ effects: setHoverLine.of(2) }).state
    expect(state.field(hoverLineField)).toBe(2)
    state = state.update({ effects: setHoverLine.of(null) }).state
    expect(state.field(hoverLineField)).toBeNull()
  })
})
