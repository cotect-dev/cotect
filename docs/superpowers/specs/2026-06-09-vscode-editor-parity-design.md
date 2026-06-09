# VS Code Editor Parity — Design

Date: 2026-06-09
Status: Approved

## Problem

Inline import pills (`InlineRefPills`) and hunk Accept/Comment buttons
(`HunkReviewLayer`) both overlay the right edge of a CodeNode editor, so they
collide when an import line falls inside a changed hunk. Beyond that, the
editor is missing several interactions VS Code developers expect (find panel,
multi-cursor, move-line, goto-line), and `Mod-D` is bound to copy-line-down,
which conflicts with VS Code's add-selection-to-next-match.

## Decision summary

- Remove inline import pills entirely. Cmd/Ctrl+click on an import line becomes
  the way to follow an import (VS Code's go-to-definition gesture). Right-side
  "imported-by" pills are unchanged.
- Add a VS Code parity package to the editor: find/replace, multi-cursor,
  line manipulation, goto-line, smart blank-line insertion.

## 1. Import navigation (Cmd/Ctrl+click)

Implemented as a CodeMirror extension (`importClick.ts` under
`src/components/Canvas/nodes/codeNode/`), not a React overlay — overlays would
block selection and duplicate geometry the editor already tracks.

- The extension reads the current line → import map through a ref, the same
  pattern `CodeNode.tsx` uses for `hunkDisplaysRef`. `computeRefLineLayouts`
  keeps producing the `inlineImports` map; it now feeds the extension instead
  of an overlay. Map values carry `{ resolvedPath, targetLine }`.
- `mousedown` with `metaKey || ctrlKey` on a mapped line: `preventDefault`,
  navigate via `focusFileByPath(resolvedPath, targetLine)`. Lines with multiple
  imports navigate to the first. Unresolved imports are not in the map → inert.
- Hover affordance: a `ViewPlugin` tracks Cmd/Ctrl + mouse position and
  decorates the hovered import line with underline + `cursor: pointer`,
  cleared on key-up / mouse-leave. Mirrors VS Code's ctrl-hover link styling.
- Line numbers in the map are document-relative; nodes sliced with `startLine`
  offsets must be accounted for consistently with how `inlineImports` lines
  were previously consumed by the pills overlay.
- Read-only diff nodes (review/commit views) share the editor build path and
  get import-click for free.

### Removals

- `InlineRefPills` component in `RefPills.tsx` (right-side pills stay).
- Its render site in `CodeNode.tsx` and the inline-line entries in the
  pill-position measurement effect.

## 2. VS Code parity keymap & features

All changes in `buildEditorExtensions` (`editorExtensions.ts`):

| Feature | Binding | Implementation |
| --- | --- | --- |
| Find / replace panel | `Mod-F`, `Mod-Alt-F`, `F3`/`Shift-F3` | `search()` + `searchKeymap` from `@codemirror/search` |
| Select next occurrence | `Mod-D` | `selectNextOccurrence` (replaces copy-line-down) |
| Select all occurrences | `Mod-Shift-L` | `selectSelectionMatches` |
| Multi-cursor | Alt+click | `EditorState.allowMultipleSelections.of(true)` |
| Move line | `Alt-Up` / `Alt-Down` | `moveLineUp` / `moveLineDown` |
| Copy line | `Shift-Alt-Up` / `Shift-Alt-Down` | `copyLineUp` / `copyLineDown` |
| Go to line | `Mod-G` | `gotoLine` |
| Insert blank line below/above | `Mod-Enter` / `Mod-Shift-Enter` | `insertBlankLine` + custom above-variant if not provided |

- Escape ordering: search panel close (from `searchKeymap`) must win over the
  existing blur-to-canvas Escape binding — `searchKeymap` is placed before the
  custom Escape entry; the custom binding only fires when no panel is open.
- Panels (search, goto-line) are styled to match the dark theme in
  `editorTheme.ts` (or a dedicated panel theme) — inputs, buttons, background.
- Read-only nodes: find/goto/import-click work; editing commands are inert via
  the existing `EditorState.readOnly` facet.

Explicitly out of scope: LSP-backed go-to-definition/rename, format-on-save,
add-cursor-above/below (no built-in CM command), minimap changes.

## Error handling

- Import click on a path that no longer exists: `focusFileByPath` already
  handles missing files gracefully; no extra handling.
- Modifier-hover state resets on window blur to avoid a stuck underline.

## Testing

- Unit tests for the click-target resolution (line → import lookup, modifier
  gating, first-import selection, unresolved lines inert).
- Existing pill/layout tests updated for the `InlineRefPills` removal.
- Manual verification in the running app: hover affordance, find panel
  styling, multi-cursor, move/copy line, goto-line, read-only nodes.
