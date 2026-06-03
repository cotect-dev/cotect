# Non-destructive commit review with comments

**Date:** 2026-06-03
**Status:** Approved design — ready for implementation plan
**Supersedes:** `2026-06-03-reopen-commit-as-changes-design.md` (the `git reset`
approach was rejected as destructive to shared branch state).

## Summary

Let a human "go back" to before a commit and review everything committed since
then — surfaced in the **Changes** panel — **without mutating git history, the
index, or the working tree**. The reviewer marks files as viewed (progress
tracking) and attaches comments to specific line ranges. Comments are collected
as text the human can copy and paste to an external agent (e.g. `claude` in a
terminal). The code is never edited or removed by the review itself; fixing is a
separate, human-initiated, currently-external step.

## Goals & constraints

- **Non-destructive / concurrent-agent-safe.** Reviewing past commits must not
  touch `HEAD`, the index, or working-tree files. Agents may be actively
  committing and editing while a human reviews older commits.
- **Surfaced in the Changes panel.** Reuse the existing panel/diff UI rather than
  inventing a separate review surface.
- **GitHub-style review.** Per-file "viewed" checkbox for progress + comments
  anchored to selected line ranges.
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
  after it, presented as one set of changes (matches the earlier "last N in
  sequence" choice).
- **Tip is snapshotted at entry.** Commits agents add *during* the review do not
  shift the review set. Re-entering review re-snapshots.
- All file contents come from `git show <sha>:<path>` (read-only). Nothing is
  reset, stashed, staged, or written.

Because it is purely read-only, it is safe to run at any time regardless of what
agents are doing.

## Scope decisions (from brainstorming)

- **Range, not single commit.** Selecting C reviews `C..tip`. (Single-commit
  diffs already exist via the History panel's `showCommitDiff`.)
- **GitHub-style granularity.** Per-file viewed checkbox; comments on line ranges.
- **Accept/decline are review verdicts, not edits.** "Declining" bad code does
  **not** remove it; it produces a comment for a human/agent to act on later.
- **Text-only handoff now.** Agent auto-launch and its configurability are
  designed-for via a seam but **not implemented** in this iteration.

### Out of scope

- Any git mutation (reset / stash / commit / rebase / revert).
- Claude / `claude -p` background-agent integration.
- The user-facing config toggle for review-action mode (only the text handler
  exists, so there is nothing to toggle yet).
- Comment-anchor re-anchoring across code drift beyond the simple strategy below.

## Components

### 1. Rust — read-only range diff

**File:** `tauri/src/git.rs` (new command), registered in `tauri/src/main.rs`.

```rust
#[tauri::command]
async fn git_diff_range(repo_path: String, base: String, head: String)
    -> Result<Vec<GitFileStatus>, String>
```

- Runs `git -C <repo> --no-optional-locks diff --numstat --name-status <base> <head>`
  (or two calls: `--name-status` for status, `--numstat` for counts) via the
  existing `run_git` helper; parses into the existing `GitFileStatus`
  (`{ path, status, insertions, deletions }`) shape.
- Read-only; follows existing `git.rs` conventions and error mapping.
- **File contents are fetched with the existing `git_show_commit_file(hash,
  path)`** — no new command needed. `before = git_show_commit_file(base, path)`
  (empty string if the file is absent in base), `after = git_show_commit_file(
  head, path)`.
- **Root commit:** if C has no parent, `base` is git's empty-tree object
  (`4b825dc642cb6eb9a060e54bf8d69288fbee4904`) so the initial commit shows as
  all-additions. The caller resolves this (see store).

### 2. Canvas store — open a range diff read-only

**File:** `src/store/canvas.ts` (extend the existing `showCommitDiff` pattern).

```ts
showRangeDiff(filePath: string, base: string, head: string): Promise<void>
```

- Mirrors `showCommitDiff` (L290–352) but with explicit base/head: fetches
  `after = git_show_commit_file(head, filePath)` and
  `before = git_show_commit_file(base, filePath)`, builds a `readOnly` CodeNode
  with `headOverride = before`, `code = after`, and metadata identifying the
  review (base/head/filePath) so the comment layer can anchor to it.
- The Changes panel (review mode) calls this instead of `focusFileByPath` when a
  reviewed file is clicked.

### 3. Review store (new) — sessions, viewed state, comments

**File:** `src/store/review.ts` (new), persisted per-project via the existing
`withPersistence` pattern (`scope: 'project'`, debounced, with
`serialize`/`deserialize` for maps).

Data model:

```ts
interface ReviewComment {
  id: string
  filePath: string
  startLine: number      // 1-based, in the head/after snapshot
  endLine: number
  snippet: string        // the reviewed code at anchor time (for context + drift detection)
  body: string           // the human's comment
  createdAt: number
}

interface ReviewSession {
  baseCommit: string     // C (the selected commit); base diff = C~1 / empty-tree
  baseRef: string        // resolved base (C~1 or empty-tree hash)
  tipSha: string         // snapshot of the branch tip at review start
  startedAt: number
  viewedFiles: Set<string>     // file paths marked "viewed"
  comments: ReviewComment[]
}

interface ReviewState {
  active: ReviewSession | null
  // Persisted history of sessions keyed by baseCommit so re-entering restores
  // viewed state + comments for the same starting point.
  sessions: Record<string /* baseCommit */, ReviewSession>
}
```

Actions:

- `startReview(baseCommit, baseRef, tipSha, files)` — set `active`, hydrate from
  `sessions[baseCommit]` if present (restoring viewed + comments).
- `exitReview()` — clear `active` (session stays persisted).
- `setViewed(filePath, viewed)`.
- `addComment(filePath, startLine, endLine, snippet, body)` /
  `updateComment(id, body)` / `removeComment(id)`.
- `exportCommentsMarkdown(): string` — see the action seam.

### 4. Changes panel — review mode

**File:** `src/components/Changes/index.tsx` (extend).

- **Entry point:** the History panel (`src/components/History/index.tsx`) gets a
  per-commit action "Review changes since this commit." On click it resolves the
  base (`<hash>~1`, or empty-tree if root), snapshots the current tip SHA
  (`log[0].hash`), calls `git_diff_range`, and `startReview(...)` with the
  resulting file list, then switches to the Files view so the Changes panel is
  visible.
- **Banner:** when `review.active`, the Changes panel shows a banner — e.g.
  *"Reviewing N commits since `<shortHash>` · X/Y files viewed"* with an **Exit
  review** button. Clearly distinct from the normal live-working-tree listing.
- **File list:** the review changeset's files (from `git_diff_range`), each row
  with its status badge (reuse existing M/A/D/U styling) and a **viewed
  checkbox**. Clicking a row opens it via `showRangeDiff(path, baseRef, tipSha)`.
  Progress (X/Y viewed) shown in the banner.
- **Comments list:** a section listing all `active.comments` (`file:line` + body,
  click to jump to the file/line), with a **Copy all** button (the text handler).
- Normal (non-review) behavior is unchanged when `review.active` is null.

### 5. Read-only CodeNode — commenting affordance + markers

**File:** `src/components/Canvas/nodes/CodeNode.tsx` (+ a small CM extension).

- When the node is a review diff (readOnly + review metadata present):
  - **Add a comment:** selecting a line range reveals a small "Comment" affordance
    (floating button on selection, or a gutter "+"). Submitting calls
    `addComment(...)` with the selected `startLine..endLine` and the selected text
    as `snippet`. Read-only state still allows selection, so this works without
    enabling edits.
  - **Show existing comments:** a CodeMirror gutter marker / line decoration on
    commented ranges; clicking opens the comment to read/edit/delete.
- Comments anchor to `{ filePath, startLine, endLine }` in the head snapshot,
  plus `snippet`. Drift handling (v1): on open, if the line content no longer
  matches `snippet`, mark the comment "stale" (still shown in the list) rather
  than silently mis-placing it. No automatic re-anchoring beyond this.

### 6. Comment-action seam (text-only now)

A single abstraction for "do something with the review's comments":

```ts
interface ReviewActionHandler {
  id: string
  label: string
  run(session: ReviewSession): Promise<void>
}
```

- The only handler now is **`copyAsMarkdown`** → builds and copies a structured
  payload, e.g.:

  ```markdown
  ## Review — commits since <shortHash>

  ### src/foo.ts:42–45
  ```
  <snippet>
  ```
  <comment body>
  ```

  via the platform clipboard API. Also exposed per-comment (copy one).
- Future "launch agent" handler + a settings toggle selecting the active handler
  plug in here without touching the store or UI data model. Not built now.

## Data flow

1. History panel: user picks commit C → "Review changes since this commit."
2. Resolve `baseRef` (`C~1` or empty-tree), snapshot `tipSha = log[0].hash`,
   call `git_diff_range(repo, baseRef, tipSha)` → file list.
3. `startReview(C, baseRef, tipSha, files)`; switch to Files view; Changes panel
   enters review mode (banner + file list with viewed checkboxes).
4. User clicks a file → `showRangeDiff(path, baseRef, tipSha)` → read-only merge
   CodeNode (before = `git show baseRef:path`, after = `git show tipSha:path`).
5. User selects lines → adds a comment (`addComment`), and/or checks "viewed".
6. User clicks **Copy all** → markdown of all comments to clipboard → pastes into
   their terminal agent. (Nothing in git or the working tree changed.)
7. **Exit review** clears `active`; the session (viewed + comments) persists and
   is restored if review is re-entered for the same base commit.

## Edge cases

- **Root commit (no parent):** base = empty-tree hash; the initial commit shows
  as all additions. Handled in the store, not by disabling the action.
- **Concurrent agent commits during review:** ignored by design — `tipSha` is
  snapshotted at entry. A subtle banner note ("tip was `<sha>`") optional.
- **File added in range:** absent in base → `before = ''` → shows as added.
- **File deleted in range:** absent in head → `after = ''` → shows as deleted;
  comments can still anchor in the base view if needed (v1: comment on the
  after/current snapshot only; deleted files are view-only, no new comments).
- **Comment anchor drift:** detected via `snippet` mismatch → comment flagged
  "stale" in the list; not silently mis-rendered.
- **Multi-window:** review state persists per-project and syncs via the existing
  `synced state` mechanism; read-only git reads run anywhere safely.
- **Concurrent live changes vs review:** review mode is clearly separated from the
  live working-tree Changes view via the banner, so the two are not confused.

## Persistence

- `review.sessions` (per `baseCommit`) persisted with `scope: 'project'` using
  `withPersistence`, debounced. `viewedFiles` (Set) and `comments` use custom
  `serialize`/`deserialize`. `active` is **not** persisted (it's reconstructed
  from `sessions` on `startReview`), avoiding a stale tipSha across restarts.

## Testing

- **Rust:** if `git.rs` has a temp-repo test harness, test `git_diff_range`
  across a 2–3 commit range (and the empty-tree/root case) and assert the parsed
  `GitFileStatus` list (paths, statuses, counts). Match existing conventions;
  skip if none.
- **Review store:** `startReview` hydrates from a persisted session;
  `setViewed`/`addComment`/`updateComment`/`removeComment` mutate correctly;
  `exportCommentsMarkdown` produces the expected text; round-trip
  serialize/deserialize of `viewedFiles`/`comments`.
- **UI:** History action computes the right base/tip and N; Changes review-mode
  banner shows correct X/Y; clicking a file opens a read-only range diff;
  selecting lines creates a comment; Copy-all yields the markdown payload.

## Conventions

- Follow existing `git.rs` command and `src/store/*.ts` (zustand +
  `withPersistence`) patterns; reuse `showCommitDiff`'s read-only CodeNode flow.
- No new modal/toast system; reuse existing inline UI patterns.
- No `Co-Authored-By` trailers in commits (project CLAUDE.md).
