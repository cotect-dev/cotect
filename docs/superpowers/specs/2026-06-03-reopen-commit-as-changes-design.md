# Reopen commit as changes (uncommit for review)

**Date:** 2026-06-03
**Status:** Approved — ready for implementation plan

## Summary

Add a way to take a commit (and everything committed after it) and move it back
into the working tree as uncommitted changes, so it can be reviewed in the
existing **Changes** panel using the existing per-chunk **accept / decline**
machinery in the code editor's merge view.

The user picks a commit in the **History** panel and chooses "Reopen as
changes" ("go back to before this commit"). The selected commit and every
commit after it (up through `HEAD`) become uncommitted working-tree changes.

## Goal & motivation

Cotect is a code-review / inspection tool. A common need is to review a commit
(e.g. one an agent or teammate made) as if it were still pending — walking it
chunk by chunk and keeping or reverting each change. The Changes panel already
shows working-tree-vs-`HEAD` and the merge view already supports accept/decline;
the only missing capability is moving committed work back into that reviewable
state.

## Mechanism (why it is safe)

The operation is implemented as:

```
git -C <repo> reset --mixed <selected_commit>~1
```

`--mixed` moves only the **HEAD pointer** and the **index**. It never modifies
working-tree file contents. The committed content already exists on disk; moving
the diff base (`HEAD`) backward is what makes those changes *surface* as
"uncommitted."

Consequences:

- **No risk to file content.** Working-tree files are untouched.
- **Recoverable.** The original commit remains reachable via `git reflog`. The
  only thing "undone" is the branch pointer.
- **Fits existing machinery.** The Changes panel reads working-tree-vs-`HEAD`,
  and the merge view's **accept** (`acceptChunk` — keep the change) / **decline**
  (`rejectChunk` — revert the working file to the new `HEAD`) already do exactly
  what is wanted. No new review UI is required.

### How each file kind surfaces after the reset

Given `git reset --mixed <selected>~1`, with the new `HEAD` being the parent of
the selected commit:

- **Modified in the reopened range:** new `HEAD` has the old content, working
  tree has the new content → shows as `M`.
- **Added in the range:** new `HEAD` does not have the file, working tree does →
  shows as untracked / added (`U` / `A`).
- **Deleted in the range:** new `HEAD` has the file, working tree does not →
  shows as deleted (`D`).

## Scope decisions (from brainstorming)

- **Which commits:** Last N in sequence. Selecting an older commit intentionally
  reopens it **plus all newer commits** — this is the linear-history reality of
  `git reset`, and is the desired behavior.
- **After review:** Just leave curated changes in the working tree. No re-commit
  flow, no staging UI in this feature.
- **Safety:** Inline confirmation + reliance on `git reflog`. No separate
  "redo" action.

### Out of scope

- Re-commit / commit-creation UI.
- A staging area.
- Arbitrary / non-linear isolation of a single mid-history commit.

## Components

### 1. Rust git command

**File:** `tauri/src/git.rs` (new command), registered in `tauri/src/main.rs`.

```rust
#[tauri::command]
async fn git_reset_mixed(repo_path: String, target: String) -> Result<(), String>
```

- Runs `git -C <repo_path> --no-optional-locks reset --mixed <target>` via the
  existing `run_git` helper (15s timeout, existing error mapping:
  `GIT_NOT_FOUND`, `NOT_A_REPO`, `GIT_TIMEOUT`).
- Returns `Ok(())` on success; propagates git stderr on failure (e.g. an
  invalid `~1` ref on the root commit).
- Follows the existing `git.rs` command conventions exactly.

### 2. Git store action

**File:** `src/store/git.ts`.

```ts
reopenCommitAsChanges(commitHash: string): Promise<boolean>
```

- Reads `repoPath` from state.
- `await invoke('git_reset_mixed', { repoPath, target: `${commitHash}~1` })`.
- On success: `await refresh()` (this re-reads `git_status`/`git_log`; `headSha`
  changes, so the `headContent` cache auto-invalidates — see `git.ts` ~L215-219),
  return `true`.
- On failure: log, set `gitError` appropriately (or leave a transient error),
  return `false`.
- Must be added to the store's persisted/exposed action set and to the
  `git-sync` action surface consistent with other mutating actions
  (`refresh` is already broadcast).

### 3. History panel UI

**File:** `src/components/History/index.tsx`.

- Each commit entry gains a **"Reopen as changes"** action (small button/affordance
  in the entry header; may reveal on hover to match existing styling).
- Clicking enters an **inline two-step confirm** (no modal system exists; do not
  introduce one). The confirm copy states the blast radius and recoverability,
  e.g.: *"Move this commit + N newer commits into your working tree? Recoverable
  via git reflog."*
  - **N** = the commit's index in the loaded log + 1 (index 0 = latest →
    "1 commit"; index k → "k+1 commits"). Singular/plural wording handled.
- On confirm:
  1. Call `reopenCommitAsChanges(commit.hash)`.
  2. On success, switch the active view to **Files/Changes** (whichever surfaces
     the Changes panel) so the reopened changes are immediately visible.
  3. On failure, show the inline error (see root-commit edge case).

## Data flow

1. User clicks "Reopen as changes" on commit C (index k in the log) → confirms.
2. Store calls `git_reset_mixed(repoPath, "<C.hash>~1")`.
3. Git moves `HEAD` and index to C's parent; working files unchanged.
4. Store `refresh()` → new `git_status` shows C..HEAD as working-tree changes;
   `git_log` no longer lists them; `headContent` cache resets because `headSha`
   (= `log[0].hash`) changed.
5. Any open `CodeNode` re-resolves its `headContent` against the new `HEAD` and
   the merge view reconfigures, so already-open files update automatically.
6. User reviews in the Changes panel; **accept** keeps a chunk, **decline**
   reverts that chunk's working-file content to the new `HEAD`.

## Edge cases

- **Root commit (no parent):** `<hash>~1` does not resolve; the Rust command
  returns a git error. The store returns `false`; the History UI shows an inline
  message: *"Can't reopen the very first commit."* (The log is paginated, so we
  rely on the command error rather than trying to pre-detect the root commit.)
- **Pre-existing uncommitted edits:** They simply combine with the reopened
  changes. `--mixed` never overwrites working files, so this is still
  non-destructive (though the diff will show both sets — expected git behavior).
- **Detached HEAD / no commits (`branch.kind === 'initial'`):** History is empty
  or the action is not meaningful; the action need not be offered.
- **Multi-window:** The reset runs in the main window per the existing command
  pattern; `refresh()` broadcasts the new state via the `git-sync` event so other
  windows update.

## Testing

- **Rust:** If `git.rs` has an existing test harness/temp-repo pattern, add a test
  that commits twice in a temp repo, calls `git_reset_mixed(repo, "HEAD~1")`, and
  asserts: `HEAD` moved to the first commit, the second commit's file change now
  appears in `git status`, and working-file content is unchanged. Match existing
  Rust test conventions (skip if none exist).
- **Store:** Following existing `git.test.ts`-style tests, mock `invoke` and
  assert `reopenCommitAsChanges(hash)` calls `git_reset_mixed` with
  `target === \`${hash}~1\`` and triggers `refresh()`; assert it returns `false`
  and does not throw when `invoke` rejects.
- **UI:** Confirm the inline two-step confirm computes N correctly from the log
  index (1 for the latest commit, k+1 for an older one) and switches to the
  Changes view on success.

## Conventions

- Follow existing `git.rs` command and `src/store/git.ts` action patterns.
- No new modal/dialog/toast system — use the inline confirm pattern.
- Commits must not include a `Co-Authored-By` trailer (per project CLAUDE.md).
