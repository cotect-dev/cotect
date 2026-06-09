# VS Code Editor Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cmd/Ctrl+click import navigation replaces inline import pills, plus VS Code parity for find/replace, multi-cursor, and keybindings in CodeNode editors.

**Architecture:** A new CodeMirror extension (`importClick.ts`) owns modifier-click navigation and hover-underline affordance, reading the line→import map through a getter (same ref pattern as `hunkDisplaysRef`). `InlineRefPills` is deleted; right-side "imported-by" pills are untouched. Keymap parity lands in `buildEditorExtensions`.

**Tech Stack:** React 19, CodeMirror 6 (`@codemirror/view`, `@codemirror/state`, `@codemirror/search`, `@codemirror/commands`), Zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-09-vscode-editor-parity-design.md`

**Conventions:** Minimal comments (non-obvious "why" only). No `Co-Authored-By` trailers. Run all commands from `/home/grzracz/dev/cotect`.

---

### Task 1: `importClick` extension (pure logic + extension)

**Files:**
- Create: `src/components/Canvas/nodes/codeNode/importClick.ts`
- Test: `src/components/Canvas/nodes/codeNode/importClick.test.ts`

Key facts for the implementer:
- `ImportRefItem` (`src/types/nodes.ts:48`) is `{ label: string; resolvedPath: string; kind: 'import' | 'imported-by'; importedNames?: string[]; targetLine?: number }`.
- The map passed in is `Map<number, ImportRefItem[]>` keyed by 1-based document line (same map `InlineRefPills` consumed; produced by `computeRefLineLayouts` in `refLineLayout.ts`).
- The hover state is a `StateField<number | null>` (hovered import line) updated by a `StateEffect`, so it is testable with `EditorState` alone (no DOM).

- [ ] **Step 1: Write the failing tests**

```ts
// src/components/Canvas/nodes/codeNode/importClick.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/Canvas/nodes/codeNode/importClick.test.ts`
Expected: FAIL — `Cannot find module './importClick'` (or equivalent).

- [ ] **Step 3: Implement the extension**

```ts
// src/components/Canvas/nodes/codeNode/importClick.ts
import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view'
import type { ImportRefItem } from '@/types/nodes'

export type InlineImportMap = Map<number, ImportRefItem[]>

export function resolveImportAtLine(
  imports: InlineImportMap | null,
  line: number,
): ImportRefItem | null {
  return imports?.get(line)?.[0] ?? null
}

export const setHoverLine = StateEffect.define<number | null>()

export const hoverLineField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setHoverLine)) value = e.value
    return value
  },
})

const hoverDecorations = EditorView.decorations.compute([hoverLineField], (state) => {
  const line = state.field(hoverLineField)
  if (line === null || line < 1 || line > state.doc.lines) return Decoration.none
  return Decoration.set([
    Decoration.line({ class: 'cm-import-link' }).range(state.doc.line(line).from),
  ]) as DecorationSet
})

const hoverTheme = EditorView.baseTheme({
  '.cm-import-link, .cm-import-link *': {
    textDecoration: 'underline',
    textDecorationColor: 'rgba(96, 165, 250, 0.8)',
    cursor: 'pointer',
  },
})

function isMod(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.metaKey || e.ctrlKey
}

// Modifier release and window blur must clear a stuck underline even
// without further mouse movement.
const modifierWatcher = ViewPlugin.define((view) => {
  const clear = () => {
    if (view.state.field(hoverLineField) !== null) {
      view.dispatch({ effects: setHoverLine.of(null) })
    }
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Meta' || e.key === 'Control') clear()
  }
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', clear)
  return {
    destroy() {
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clear)
    },
  }
})

/** Cmd/Ctrl+click on an import line navigates to the imported file; while the
 *  modifier is held the hovered import line is underlined (VS Code style). */
export function importClickExtension(
  getImports: () => InlineImportMap | null,
  onNavigate: (item: ImportRefItem) => void,
): Extension {
  const lineAtCoords = (view: EditorView, e: MouseEvent): number | null => {
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
    return pos === null ? null : view.state.doc.lineAt(pos).number
  }

  const applyHover = (view: EditorView, line: number | null) => {
    const importLine = line !== null && resolveImportAtLine(getImports(), line) ? line : null
    if (view.state.field(hoverLineField) !== importLine) {
      view.dispatch({ effects: setHoverLine.of(importLine) })
    }
  }

  const domHandlers = EditorView.domEventHandlers({
    mousedown: (e, view) => {
      if (e.button !== 0 || !isMod(e)) return false
      const line = lineAtCoords(view, e)
      const item = line === null ? null : resolveImportAtLine(getImports(), line)
      if (!item) return false
      e.preventDefault()
      onNavigate(item)
      return true
    },
    mousemove: (e, view) => {
      applyHover(view, isMod(e) ? lineAtCoords(view, e) : null)
      return false
    },
    mouseleave: (_e, view) => {
      applyHover(view, null)
      return false
    },
  })

  return [hoverLineField, hoverDecorations, hoverTheme, domHandlers, modifierWatcher]
}
```

Note: a `mousedown` handler returning `true` runs before CodeMirror's built-in
selection handling, so a modifier-click never moves the cursor. The unused
`EditorState` import warning, if any, means it was left over — only import what
the file references.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/Canvas/nodes/codeNode/importClick.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc -b && yarn lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/Canvas/nodes/codeNode/importClick.ts src/components/Canvas/nodes/codeNode/importClick.test.ts
git commit -m "feat(code-node): cmd/ctrl+click import navigation extension"
```

---

### Task 2: Wire extension into CodeNode, delete InlineRefPills

**Files:**
- Modify: `src/components/Canvas/nodes/codeNode/editorExtensions.ts` (options + extension list)
- Modify: `src/components/Canvas/nodes/CodeNode.tsx` (wire getter/navigate, remove pill overlay)
- Modify: `src/components/Canvas/nodes/codeNode/RefPills.tsx` (delete `InlineRefPills`)

- [ ] **Step 1: Add the extension to `buildEditorExtensions`**

In `editorExtensions.ts`, extend the options interface and extension list:

```ts
import { importClickExtension, type InlineImportMap } from './importClick'
import type { ImportRefItem } from '@/types/nodes'

export interface EditorExtensionOptions {
  // ...existing fields unchanged...
  getInlineImports: () => InlineImportMap | null
  onOpenImport: (item: ImportRefItem) => void
}
```

In the returned array, immediately after `rainbowBrackets`:

```ts
importClickExtension(opts.getInlineImports, opts.onOpenImport),
```

- [ ] **Step 2: Wire CodeNode**

In `CodeNode.tsx`:

1. Add a ref kept current each render, next to the existing `hunkDisplaysRef` pattern (`CodeNode.tsx:75,143`):

```ts
const inlineImportsRef = useRef<InlineImportMap | null>(null)
inlineImportsRef.current = inlineImports
```

(place the assignment right after the `useMemo` computing `inlineImports`, ~line 106.)

2. In the `buildEditorExtensions` call (~line 207), add:

```ts
getInlineImports: () => inlineImportsRef.current,
onOpenImport: (item) =>
  void useCanvasStore.getState().focusFileByPath(item.resolvedPath, item.targetLine),
```

(`focusFileByPath(repoRelativePath, scrollToLine?)` — `src/store/canvas.ts:76`; this is exactly what `Pill.handleClick` in `ImportRefNode.tsx:35` does.)

3. Remove the inline pill overlay:
   - Delete the `<InlineRefPills …/>` block (~lines 615-621) and change the import at line 32 to `import { RightSideRefPills } from './codeNode/RefPills'`.
   - Delete `inlineOverlayRef` (line 73) and its scroll-translate line (`if (inlineOverlayRef.current) …` ~line 234).
   - In the line-position measurement effect (~lines 386-432): drop `inlineImports` from the guard (`if (!view || !rightSideLayout)`), from the `allLines` set (remove `...(inlineImports?.keys() ?? [])`), and from the dependency array.

   Add `import type { InlineImportMap } from './codeNode/importClick'` for the ref type.

- [ ] **Step 3: Delete `InlineRefPills` from `RefPills.tsx`**

Remove the `InlineRefPills` function (lines 13-41) and the now-unused `ImportRefItem` import if nothing else in the file uses it (the `Pill` import and `RefLine` type are still used by `RightSideRefPills`). Keep `lineTop` (used by `RightSideRefPills`).

- [ ] **Step 4: Verify nothing else references the removed pieces**

Run: `grep -rn "InlineRefPills\|inlineOverlayRef" src/`
Expected: no matches.

- [ ] **Step 5: Typecheck, lint, run node tests**

Run: `npx tsc -b && yarn lint && npx vitest run src/components src/store/canvas.test.ts`
Expected: all clean / all pass. `computeRefLineLayouts` still produces `inlineImports` (now feeding the extension), so `refLineLayout.ts` is unchanged.

- [ ] **Step 6: Commit**

```bash
git add -A src/components/Canvas/nodes
git commit -m "feat(code-node): replace inline import pills with cmd+click line navigation"
```

---

### Task 3: VS Code keymap parity (search, multi-cursor, bindings)

**Files:**
- Modify: `src/components/Canvas/nodes/codeNode/editorExtensions.ts`
- Modify: `src/components/Canvas/nodes/codeNode/editorTheme.ts` (panel styling)

What already works via `defaultKeymap` and existing config (do NOT rebind): `Alt-Up/Down` move line, `Shift-Alt-Up/Down` copy line, `Ctrl/Cmd-Alt-Up/Down` add cursor (needs the facet below), `Mod-Enter` insert blank line below, `Mod-/` comment, `Mod-Shift-K` delete line, fold keymap.

- [ ] **Step 1: Add search + multi-cursor extensions**

In `editorExtensions.ts`:

```ts
import { search, searchKeymap, gotoLine, selectSelectionMatches } from '@codemirror/search'
import { insertBlankLine, /* existing imports stay */ } from '@codemirror/commands'
import { EditorSelection } from '@codemirror/state'
```

(keep the existing `highlightSelectionMatches` import; remove `copyLineDown` from the `@codemirror/commands` import — its custom binding goes away.)

In the extension array, next to `highlightSelectionMatches()`:

```ts
search({ top: true }),
EditorState.allowMultipleSelections.of(true),
```

- [ ] **Step 2: Add `insertBlankLineAbove` and rework the keymap**

Add above `buildEditorExtensions`:

```ts
import type { StateCommand } from '@codemirror/state'

/** VS Code's Ctrl+Shift+Enter — CM only ships the below-variant. */
const insertBlankLineAbove: StateCommand = ({ state, dispatch }) => {
  const changes = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from)
    const indent = /^\s*/.exec(line.text)?.[0] ?? ''
    return {
      changes: { from: line.from, insert: `${indent}\n` },
      range: EditorSelection.cursor(line.from + indent.length),
    }
  })
  dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'input' }))
  return true
}
```

Replace the existing `keymap.of([...])` block (`editorExtensions.ts:99-125`) with:

```ts
keymap.of([
  {
    key: 'Mod-s',
    run: () => {
      opts.onSave()
      return true
    },
  },
  // Before searchKeymap so Mod-g means goto-line (VS Code), not find-next;
  // F3/Shift-F3 still cover find navigation.
  { key: 'Mod-g', run: gotoLine },
  { key: 'Mod-Shift-l', run: selectSelectionMatches },
  { key: 'Mod-Shift-Enter', run: insertBlankLineAbove },
  // searchKeymap before the blur-Escape: closeSearchPanel returns false when
  // no panel is open, falling through to the canvas blur below.
  ...searchKeymap,
  {
    key: 'Escape',
    run: (view) => {
      view.contentDOM.blur()
      const container = document.querySelector('[data-canvas-container]') as HTMLElement | null
      container?.focus()
      return true
    },
  },
  { key: 'Mod-Shift-k', run: deleteLine },
  { key: 'Mod-/', run: toggleComment },
  { key: 'Tab', run: acceptCompletion },
  indentWithTab,
  ...closeBracketsKeymap,
  ...defaultKeymap,
  ...historyKeymap,
  ...foldKeymap,
]),
```

Notes:
- The `Mod-d: copyLineDown` binding is deleted; `searchKeymap` now supplies `Mod-d: selectNextOccurrence` (VS Code), and `Shift-Alt-Down` (defaultKeymap) covers copy-line-down.
- `searchKeymap` also supplies `Mod-f`, `F3`/`Shift-F3`, `Mod-Alt-g` (goto-line alternative) — `Mod-g: gotoLine` placed earlier shadows `searchKeymap`'s `Mod-g: findNext`.
- `insertBlankLine` needs no explicit binding (`Mod-Enter` in defaultKeymap) — do not import it if unused after this; only import what the file references.

- [ ] **Step 3: Style the search/goto panels to match the dark theme**

In `editorTheme.ts`, add to the existing `codeEditorTheme` `EditorView.theme({...})` object (alongside the current `.cm-content`/scroller rules):

```ts
'.cm-panels': {
  backgroundColor: 'var(--color-background)',
  color: 'var(--color-foreground)',
  borderBottom: '1px solid var(--color-border)',
  zIndex: 25,
},
'.cm-panels.cm-panels-bottom': {
  borderTop: '1px solid var(--color-border)',
  borderBottom: 'none',
},
'.cm-panel.cm-search, .cm-panel.cm-gotoLine': {
  fontSize: '11px',
  fontFamily: 'var(--font-mono, monospace)',
  padding: '4px 6px',
},
'.cm-panel input, .cm-panel button, .cm-panel label': {
  fontSize: '11px',
},
'.cm-textfield': {
  backgroundColor: 'var(--color-muted)',
  border: '1px solid var(--color-border)',
  borderRadius: '3px',
  color: 'var(--color-foreground)',
},
'.cm-button': {
  backgroundColor: 'var(--color-muted)',
  backgroundImage: 'none',
  border: '1px solid var(--color-border)',
  borderRadius: '3px',
  color: 'var(--color-foreground)',
  cursor: 'pointer',
},
'.cm-button:active': {
  backgroundImage: 'none',
  backgroundColor: 'var(--color-accent)',
},
'.cm-panel.cm-search [name=close], .cm-panel.cm-gotoLine [name=close]': {
  color: 'var(--color-muted-foreground)',
  cursor: 'pointer',
},
```

(If `editorTheme.ts` uses literal colors instead of CSS variables, match the file's existing convention — read it first and reuse whatever token form the surrounding rules use.)

- [ ] **Step 4: Typecheck, lint, full test suite**

Run: `npx tsc -b && yarn lint && yarn test`
Expected: all clean / all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Canvas/nodes/codeNode/editorExtensions.ts src/components/Canvas/nodes/codeNode/editorTheme.ts
git commit -m "feat(code-node): VS Code keymap parity — search panel, multi-cursor, goto-line"
```

---

### Task 4: Full verification + manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Full check suite**

Run: `yarn fmt:check && npx tsc -b && yarn lint && yarn test && yarn vite:build`
Expected: everything green. If `fmt:check` fails, run `yarn fmt` and re-run.

- [ ] **Step 2: Manual smoke test in the app**

Launch with `yarn dev` (Tauri) or `yarn vite:dev` (browser) and verify in a CodeNode:
1. Hold Cmd/Ctrl and hover an import line → line underlines, pointer cursor; release modifier → underline clears.
2. Cmd/Ctrl+click the import line → navigates to the imported file (and scrolls to `targetLine` when set).
3. No inline pills render at the right edge; right-side "imported-by" pills still render; hunk Accept/Comment buttons no longer collide with pills.
4. `Mod-F` opens themed find panel at the top; Escape closes it; second Escape blurs to canvas.
5. `Mod-D` selects next occurrence (multi-cursor); Alt+click adds a cursor; `Mod-Shift-L` selects all occurrences.
6. `Alt-Up/Down` moves a line; `Shift-Alt-Down` copies it; `Mod-Enter` / `Mod-Shift-Enter` insert blank lines below/above.
7. `Mod-G` opens goto-line.
8. Read-only diff node (open a commit from History): find, goto-line, and import-click work; editing commands are inert.

- [ ] **Step 3: Fix anything found, re-run checks, commit fixes**

Any fix: smallest change that preserves the design; re-run the Step 1 suite before committing.
