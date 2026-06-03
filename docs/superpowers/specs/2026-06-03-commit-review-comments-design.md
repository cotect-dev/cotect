# Non-destructive commit review with per-hunk comments

**Date:** 2026-06-03 (revised: per-hunk granularity)
**Status:** Approved design
**Supersedes:** `2026-06-03-reopen-commit-as-changes-design.md` (the `git reset`
approach was rejected as destructive to shared branch state).

> **Revision note:** The first build used per-file "viewed" granularity
> (GitHub-style). It is being reworked to **per-change-hunk** review: a file can
> have several hunks, and each hunk is independently accepted or commented.

## Summary

Let a human "go back" to before a commit and review everything committed since
then — surfaced in the **Changes** panel — **without mutating git history, the
index, or the working tree**. The reviewer works **hunk by hunk**: each change
hunk can be **accepted** (looks good) or **commented** (flagged for an agent to
fix). Comments are collected as text the human can copy and paste to an external
agent (e.g. `claude` in a terminal). The code is never edited or removed by the
review itself; fixing is a separate, human-initiated, currently-external step.

## Goals & constraints

- **Non-destructive / concurrent-agent-safe.** Reviewing past commits must not
  touch `HEAD`, the index, or working-tree files. Agents may be actively
  committing and editing while a human reviews older commits.
- **Surfaced in the Changes panel.** Reuse the existing panel/diff UI rather than
  inventing a separate review surface.
- **Per-hunk review.** Each diff hunk is independently accepted or commented;
  progress is tracked per hunk. Controls live **on each hunk in the diff**.
- **Text-only handoff for now.** Comments are exported as text (clipboard /
  markdown). No Claude/agent integration is built in this iteration.
- **Pluggable action seam.** The "what happens with a comment" step is an
  abstraction with a single implementation now (text export). A future
  "auto-launch agent" mode and its config toggle must drop in without reworking
  the data model or UI.

## Mechanism (why it is non-destructive)

The review changeset is a **read-only virtual diff** computed straight from the
git object database — it never moves `HEAD` or writes the working tree.

- Reviewing "since commit C" means diffing **base = `C~1`** (the state *before*
  C) against **head = the current branch tip**, captured as a fixed SHA at the
  moment review starts (`tipSHA`).
- The changeset = `git diff <base>..<tipSHA>` — i.e. commit C and every commit
  after it, presented as one set of changes.
- **Tip is snapshotted at entry.** Commits agents add *during* the review do not
  shift the review set. Re-entering review re-snapshots.
- All file contents come from `git show <sha>:<path>` (read-only). Nothing is
  reset, stashed, staged, or written.

## Hunks: single source of truth

Hunks come from **git**, so the Changes panel's totals and the in-diff
interactive units never disagree.

- `git_diff_range` returns, per file, the list of **after-side hunk ranges**
  parsed from the `@@ -a,b +c,d @@` headers of `git diff <base> <head>` (default
  context). For each hunk we keep the after-side `startLine` (= `c`) and
  `lineCount` (= `d`).
- The **after** document shown in the review editor is exactly
  `git show <tipSHA>:<path>`, so each hunk's `+c,d` maps directly to editor line
  numbers — the gutter controls anchor on `startLine`.
- The merge view (existing `buildMergeExtension`) still renders the red/green
  diff visuals; git hunks drive the interactive accept/comment units.

## Scope decisions (from brainstorming + revision)

- **Range, not single commit.** Selecting C reviews `C..tip`.
- **Per-hunk granularity.** Controls on each hunk in the diff. (Revised from the
  earlier per-file "viewed" choice.)
- **Reviewed = accepted OR commented.** A hunk counts toward progress once it is
  accepted or has at least one comment.
- **Accept/comment are review verdicts, not edits.** "Commenting" a hunk does
  **not** change code; it produces a comment for a human/agent to act on later.
  "Accept" only records that the hunk looks good.
- **Text-only handoff now.** Agent auto-launch and its configurability are
  designed-for via a seam but **not implemented** in this iteration.

### Out of scope

- Any git mutation (reset / stash / commit / rebase / revert).
- Claude / `claude -p` background-agent integration.
- The user-facing config toggle for review-action mode (only the text handler
  exists, so there is nothing to toggle yet).
- Inline editing of an existing comment's body (add + delete only for now).
- Sub-hunk / arbitrary line-range comment anchoring (comments anchor to a hunk).

## Components

### 1. Rust — read-only range diff with per-file hunks

**File:** `tauri/src/git.rs`, registered in `tauri/src/main.rs`.

`git_diff_range(repo_path, base, head) -> Result<Vec<GitFileStatus>, String>`
already returns `{ path, status, insertions, deletions }` per changed file. Extend
its result type with a `hunks` list:

```rust
#[derive(Serialize)]
pub struct GitHunk {
    pub start_line: u32, // after-side first line (the `c` of `+c,d`)
    pub line_count: u32, // after-side line count (`d`); 0 for pure deletions
}
// GitFileStatus gains: pub hunks: Vec<GitHunk>
```

- Parse the after-side hunk ranges from `git diff --no-renames <base> <head>`
  `@@ -a,b +c,d @@` headers, grouped per file (track the current file from the
  `+++ b/<path>` line; map back to the `name-status` path set). Default context.
- For a pure deletion hunk (`+c,0`), `start_line = c` (the line after which the
  deletion sits), `line_count = 0` — the gutter control anchors there.
- Read-only; follows existing `git.rs` conventions and error mapping.
- File contents still come from the existing `git_show_commit_file`.
- **Root commit:** caller passes the empty-tree hash as `base` (unchanged).

The serialized field names cross the IPC boundary as the JS shape
`{ startLine, lineCount }` (serde camelCase already used elsewhere — match the
existing convention in `git.rs`; if snake_case is emitted, the TS type uses the
emitted names). Confirm against existing structs during implementation.

### 2. Review store — sessions, per-hunk state, comments

**File:** `src/store/review.ts` (per-project persisted via `withPersistence`).

```ts
export interface ReviewHunk {
  startLine: number // after-side, 1-based
  lineCount: number
}

export interface ReviewFile {
  path: string // repo-relative
  status: string
  insertions: number
  deletions: number
  hunks: ReviewHunk[]
}

export interface ReviewComment {
  id: string
  filePath: string // repo-relative
  hunkStartLine: number // the hunk this comment belongs to
  startLine: number // = hunkStartLine (kept for display/range)
  endLine: number // hunkStartLine + lineCount - 1 (>= startLine)
  snippet: string // hunk's after-side text at anchor time
  body: string
  createdAt: number
}

export interface ReviewSession {
  baseCommit: string
  baseRef: string
  tipSha: string
  startedAt: number
  files: ReviewFile[]
  acceptedHunks: Set<string> // keys: `${filePath}:${hunkStartLine}`
  comments: ReviewComment[]
}
```

Helpers/actions:

- `hunkKey(filePath, startLine) => \`${filePath}:${startLine}\``.
- `startReview(baseCommit, baseRef, tipSha, files)` — restores prior session's
  `acceptedHunks` + `comments` if present, fresh `tipSha`.
- `exitReview()`.
- `acceptHunk(filePath, startLine)` / `unacceptHunk(filePath, startLine)` —
  toggle membership in `acceptedHunks`.
- `addComment(filePath, hunk: ReviewHunk, snippet, body)` — anchors to the hunk;
  `removeComment(id)`.
- Derived (selectors/helpers, not stored):
  - a hunk is **reviewed** if `acceptedHunks.has(key)` OR any comment has
    `filePath === f && hunkStartLine === startLine`.
  - per-file reviewed count and total (`file.hunks.length`); overall totals.
- `exportCommentsMarkdown()` — unchanged in shape (`### <path>:<range>` + fenced
  snippet + body), sorted by path then start line.
- Persist only `sessions` (scope `project`) with Set (de)serialization, as today.
  `active` not persisted; cleared on project switch (existing behavior).

### 3. CodeNode — per-hunk gutter controls + state visuals

**Files:** `src/components/Canvas/nodes/CodeNode.tsx`,
`src/components/Canvas/nodes/cmPlugins.ts`.

For a review node (`data.review.filePath` set), the editor receives the file's
hunks and their review state and renders:

- A **CodeMirror gutter** (`gutter` + `GutterMarker`) with a marker on each
  hunk's `startLine`. The marker shows state: unreviewed (neutral dot),
  **accepted** (green ✓), **commented** (amber 💬). Markers scroll natively with
  the code. Clicking a marker opens a small action popover: **Accept / Unaccept**
  and **Comment**.
- The hunk list + state are pushed into the editor via a `StateField` updated by
  a `StateEffect` (mirrors the Task-8 `setCommentRanges` pattern): the field
  holds `{ startLine, state }[]` and provides the gutter markers + (reused)
  changed-line highlight.
- **Accept** → `acceptHunk(filePath, startLine)`. **Comment** → opens the comment
  overlay (the existing Task-7 overlay, repurposed to anchor to the hunk rather
  than an arbitrary selection) and calls `addComment(filePath, hunk, snippet,
  body)` where `snippet` is the hunk's after-side text
  (`sliceDoc(line(startLine).from, line(endLine).to)`).
- The line-selection comment path from the first build is removed; commenting is
  initiated from the hunk marker.

`cmPlugins.ts` gains the gutter + state field (`setReviewHunks` effect,
`reviewHunkField`, gutter, theme). Non-review nodes are unaffected (extension
only added when `reviewFilePath` is set).

### 4. Changes panel — review mode with per-hunk progress

**File:** `src/components/Changes/index.tsx`.

- Entry from History unchanged (`git_diff_range` now returns hunks too).
- Banner shows **overall hunk progress**: `Review · <sha7> · <reviewedHunks>/<totalHunks> hunks`.
- Each file row (`ReviewFileEntry`) shows its **per-file hunk progress**
  (`reviewed/total`, e.g. `2/3`) instead of a viewed checkbox; clicking opens the
  file via `showRangeDiff`. A file with all hunks reviewed is dimmed/checked.
- Comments list + **Copy all** (markdown to clipboard) stay; each comment shows
  `path:range` and jumps to the file on click; delete (✕) per comment.

### 5. Comment-action seam (text-only now)

Unchanged from the prior design: a `ReviewActionHandler` abstraction with one
implementation — `copyAsMarkdown` (clipboard). Future agent handler + settings
toggle plug in here. Not built now.

## Data flow

1. History: pick commit C → "review". Resolve `baseRef` (`C~1` or empty-tree),
   snapshot `tipSha`, call `git_diff_range` → files (each with `hunks`),
   `startReview`, switch to Files view.
2. Changes panel: banner + per-file hunk progress. Click a file → `showRangeDiff`
   → read-only merge CodeNode; the file's hunks + state are pushed into the editor.
3. In the diff: each hunk shows a gutter marker. Accept (✓) → `acceptHunk`;
   Comment (💬) → overlay → `addComment` anchored to the hunk. Markers update;
   per-file and overall progress update.
4. Copy all → markdown of comments to clipboard → paste into a terminal agent.
   Nothing in git or the working tree changed.
5. Exit clears `active`; the session (accepted hunks + comments) persists and is
   restored on re-entry for the same base commit.

## Edge cases

- **Root commit:** base = empty-tree hash; initial commit shows as all-additions
  (single big add hunk per file).
- **Concurrent agent commits during review:** ignored — `tipSha` snapshotted.
- **Pure-deletion hunk** (`+c,0`): anchored at line `c`, `lineCount` 0 → the
  comment range is the single anchor line; the gutter marker sits there.
- **File added in range:** one hunk covering the whole file. **Deleted in range:**
  after-content empty → no hunks → file shows `0/0` (nothing to review); the row
  is informational only.
- **Hunk/comment anchor drift across re-entry:** if the snapshot changed, a
  stored `acceptedHunks` key or comment `hunkStartLine` may not match a current
  hunk → such entries are treated as stale (still listed in the comment list,
  not mis-rendered in the gutter). No auto re-anchoring.
- **Multi-window / persistence:** per-project, synced via existing mechanism.

## Persistence

- `review.sessions` (per `baseCommit`) persisted `scope: 'project'`, debounced;
  `acceptedHunks` (Set) and `comments` use custom serialize/deserialize. `active`
  not persisted (reconstructed on `startReview`).

## Testing

- **Rust:** test `git_diff_range` returns correct per-file `hunks` (after-side
  start/count) for a multi-hunk file, an added file, and the empty-tree/root case
  (existing temp-repo harness).
- **Review store:** `acceptHunk`/`unacceptHunk` toggle; reviewed = accepted OR
  commented; per-file + overall progress helpers; `addComment` anchors to the
  hunk; `exportCommentsMarkdown`; round-trip serialize/deserialize of
  `acceptedHunks`/`comments`.
- **UI:** History computes base/tip; Changes banner/file rows show correct
  hunk progress; opening a file shows a gutter marker per hunk; accept toggles
  state; comment adds an anchored comment; Copy-all yields markdown.

## Conventions

- Follow existing `git.rs` and `src/store/*.ts` (zustand + `withPersistence`)
  patterns; reuse `showCommitDiff`'s read-only CodeNode flow and the Task-8
  StateField/effect/gutter pattern.
- No new modal/toast system.
- No `Co-Authored-By` trailers (project CLAUDE.md).
```
