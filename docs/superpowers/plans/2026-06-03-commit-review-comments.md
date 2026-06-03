# Non-destructive Commit Review with Comments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a human review a commit and everything committed since it, surfaced read-only in the Changes panel, with per-file "viewed" tracking and line-range comments exported as text — never mutating git history or the working tree.

**Architecture:** A new read-only Rust command (`git_diff_range`) computes the changeset for `base..tip`. A new per-project-persisted `review` zustand store holds the active review session (snapshotted tip SHA, viewed files, comments). The History panel starts a review; the Changes panel renders review mode (file list + viewed checkboxes + banner + comments list + copy-to-clipboard); a read-only CodeNode (reusing the existing `showCommitDiff` merge-view flow) shows each file's diff and hosts comment creation/display. The comment-action layer is a thin seam with one implementation (markdown clipboard export) so an agent-launch mode can be added later.

**Tech Stack:** Tauri/Rust (`tokio::process` git), React + TypeScript, zustand (+ `withPersistence`), CodeMirror 6, Vitest, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-06-03-commit-review-comments-design.md`

---

## Phase 1 — Non-destructive review surface

### Task 1: Rust `git_diff_range` command

**Files:**
- Modify: `tauri/src/git.rs` (add command near `git_show_commit_file`, ~line 349; add test in the existing `#[cfg(test)] mod tests`)
- Modify: `tauri/src/main.rs:63-73` (register command)

The empty-tree object id (`4b825dc642cb6eb9a060e54bf8d69288fbee4904`) is git's canonical hash for an empty tree; diffing against it makes a root commit show as all-additions. Callers pass it as `base` when the selected commit has no parent.

- [ ] **Step 1: Write the failing test**

Add to `tauri/src/git.rs` inside `mod tests` (after the existing tests, before the closing `}`):

```rust
    #[tokio::test]
    async fn git_diff_range_lists_changes_between_two_commits() {
        let (_dir, repo) = make_repo();
        write_and_commit(&repo, "a.txt", "one\n", "c1");
        write_and_commit(&repo, "a.txt", "one\ntwo\n", "c2");
        write_and_commit(&repo, "b.txt", "new\n", "c3");

        // Diff from c1 (HEAD~2) to HEAD: a.txt modified, b.txt added.
        let files = git_diff_range(repo.clone(), "HEAD~2".to_string(), "HEAD".to_string())
            .await
            .unwrap();

        let mut paths: Vec<(String, String)> =
            files.iter().map(|f| (f.path.clone(), f.status.clone())).collect();
        paths.sort();
        assert_eq!(
            paths,
            vec![
                ("a.txt".to_string(), "M".to_string()),
                ("b.txt".to_string(), "A".to_string()),
            ]
        );
        let a = files.iter().find(|f| f.path == "a.txt").unwrap();
        assert_eq!(a.insertions, 1);
        assert_eq!(a.deletions, 0);
    }

    #[tokio::test]
    async fn git_diff_range_against_empty_tree_is_all_additions() {
        let (_dir, repo) = make_repo();
        write_and_commit(&repo, "a.txt", "x\ny\n", "c1");
        let empty_tree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

        let files = git_diff_range(repo.clone(), empty_tree.to_string(), "HEAD".to_string())
            .await
            .unwrap();

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "a.txt");
        assert_eq!(files[0].status, "A");
        assert_eq!(files[0].insertions, 2);
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tauri && cargo test git_diff_range -- --nocapture`
Expected: FAIL — `cannot find function 'git_diff_range' in this scope`.

- [ ] **Step 3: Implement the command**

Add to `tauri/src/git.rs` immediately after `git_show_commit_file` (after line 349). It reuses the existing `parse_numstat` helper and maps `--name-status` codes the same way `parse_porcelain` does:

```rust
/// Read-only diff of a commit range, `base..head`. Returns one entry per
/// changed file with status (M/A/D/R) and insertion/deletion counts. Never
/// touches HEAD, the index, or the working tree — safe to run while agents
/// are committing. Pass the empty-tree hash as `base` for a root commit.
#[tauri::command]
pub async fn git_diff_range(
    repo_path: String,
    base: String,
    head: String,
) -> Result<Vec<GitFileStatus>, String> {
    let range_base = base.as_str();
    let range_head = head.as_str();

    let numstat = run_git(&repo_path, &["diff", "--numstat", range_base, range_head])
        .await
        .unwrap_or_default();
    let name_status = run_git(&repo_path, &["diff", "--name-status", range_base, range_head]).await?;

    let stats = parse_numstat(&numstat);

    let mut files = Vec::new();
    for line in name_status.lines() {
        let mut parts = line.split('\t');
        let code = match parts.next() {
            Some(c) if !c.is_empty() => c,
            _ => continue,
        };
        // Renames/copies report `R100\told\tnew`; the new path is the last field.
        let path = match parts.last() {
            Some(p) if !p.is_empty() => p.to_string(),
            _ => continue,
        };
        let status = match code.chars().next().unwrap_or('M') {
            'A' => "A",
            'D' => "D",
            'R' => "R",
            'C' => "A",
            _ => "M",
        }
        .to_string();
        let (insertions, deletions) = stats.get(&path).copied().unwrap_or((0, 0));
        files.push(GitFileStatus {
            path,
            status,
            insertions,
            deletions,
        });
    }

    Ok(files)
}
```

- [ ] **Step 4: Register the command**

In `tauri/src/main.rs`, add to the `tauri::generate_handler!` list after `git::git_show_commit_file,` (line 72):

```rust
            git::git_diff_range,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd tauri && cargo test git_diff_range`
Expected: PASS (both tests). Then `cd tauri && cargo build` — Expected: builds clean.

- [ ] **Step 6: Commit**

```bash
git add tauri/src/git.rs tauri/src/main.rs
git commit -m "feat(git): add read-only git_diff_range command"
```

---

### Task 2: Review store — session + viewed state (no comments yet)

**Files:**
- Create: `src/store/review.ts`
- Create: `src/store/review.test.ts`
- Modify: `src/store/index.ts` (export)
- Modify: `src/hooks/useWindowLifecycle.ts:14` (side-effect import so the store registers before `initPersistence`)

The store mirrors the canvas store's `createStoreWithHMR` + `withPersistence` pattern (`src/store/canvas.ts:82-105`). `active` is NOT persisted (rebuilt on `startReview`); `sessions` IS persisted per-project so viewed/comment state survives restarts and re-entry.

- [ ] **Step 1: Write the failing test**

Create `src/store/review.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useReviewStore, type ReviewFile } from './review'

const files: ReviewFile[] = [
  { path: 'src/a.ts', status: 'M', insertions: 3, deletions: 1 },
  { path: 'src/b.ts', status: 'A', insertions: 5, deletions: 0 },
]

beforeEach(() => {
  useReviewStore.setState({ active: null, sessions: {} })
})

describe('review store — session + viewed', () => {
  it('startReview creates an active session', () => {
    useReviewStore.getState().startReview('abc1234', 'abc1234~1', 'tip999', files)
    const s = useReviewStore.getState().active!
    expect(s.baseCommit).toBe('abc1234')
    expect(s.baseRef).toBe('abc1234~1')
    expect(s.tipSha).toBe('tip999')
    expect(s.files).toEqual(files)
    expect(s.viewedFiles.size).toBe(0)
  })

  it('setViewed toggles a file and persists into sessions', () => {
    const r = useReviewStore.getState()
    r.startReview('abc1234', 'abc1234~1', 'tip999', files)
    r.setViewed('src/a.ts', true)
    expect(useReviewStore.getState().active!.viewedFiles.has('src/a.ts')).toBe(true)
    expect(
      useReviewStore.getState().sessions['abc1234'].viewedFiles.has('src/a.ts'),
    ).toBe(true)
    r.setViewed('src/a.ts', false)
    expect(useReviewStore.getState().active!.viewedFiles.has('src/a.ts')).toBe(false)
  })

  it('re-entering a base commit restores prior viewed state with a fresh tip', () => {
    const r = useReviewStore.getState()
    r.startReview('abc1234', 'abc1234~1', 'tip999', files)
    r.setViewed('src/b.ts', true)
    r.exitReview()
    expect(useReviewStore.getState().active).toBeNull()
    r.startReview('abc1234', 'abc1234~1', 'tipNEW', files)
    const s = useReviewStore.getState().active!
    expect(s.tipSha).toBe('tipNEW')
    expect(s.viewedFiles.has('src/b.ts')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/store/review.test.ts`
Expected: FAIL — cannot resolve `./review`.

- [ ] **Step 3: Implement the store**

Create `src/store/review.ts`:

```ts
import { create } from 'zustand'
import { createStoreWithHMR } from '@/lib/hmr'
import { withPersistence } from '@/store/persistence'

export interface ReviewFile {
  path: string // repo-relative
  status: string // 'M' | 'A' | 'D' | 'R' | 'U'
  insertions: number
  deletions: number
}

export interface ReviewComment {
  id: string
  filePath: string // repo-relative
  startLine: number // 1-based, in the head/after snapshot
  endLine: number
  snippet: string // reviewed code at anchor time (context + drift detection)
  body: string
  createdAt: number
}

export interface ReviewSession {
  baseCommit: string // selected commit C
  baseRef: string // resolved base diff ref (C~1 or empty-tree hash)
  tipSha: string // branch tip snapshot at review start
  startedAt: number
  files: ReviewFile[]
  viewedFiles: Set<string>
  comments: ReviewComment[]
}

interface PersistedSession extends Omit<ReviewSession, 'viewedFiles'> {
  viewedFiles: string[]
}

interface ReviewState {
  active: ReviewSession | null
  sessions: Record<string, ReviewSession> // keyed by baseCommit
  startReview: (
    baseCommit: string,
    baseRef: string,
    tipSha: string,
    files: ReviewFile[],
  ) => void
  exitReview: () => void
  setViewed: (filePath: string, viewed: boolean) => void
}

// Persist `sessions` only. Sets need explicit (de)serialization.
function serializeSessions(sessions: Record<string, ReviewSession>): Record<string, PersistedSession> {
  const out: Record<string, PersistedSession> = {}
  for (const [k, s] of Object.entries(sessions)) {
    out[k] = { ...s, viewedFiles: [...s.viewedFiles] }
  }
  return out
}

function deserializeSessions(raw: unknown): Record<string, ReviewSession> {
  const out: Record<string, ReviewSession> = {}
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, PersistedSession>)) {
      out[k] = {
        ...v,
        viewedFiles: new Set(v.viewedFiles ?? []),
        comments: v.comments ?? [],
        files: v.files ?? [],
      }
    }
  }
  return out
}

// Persist the active session back into `sessions` after every mutation.
function persistActive(
  active: ReviewSession | null,
  sessions: Record<string, ReviewSession>,
): Record<string, ReviewSession> {
  if (!active) return sessions
  return { ...sessions, [active.baseCommit]: active }
}

export const useReviewStore = createStoreWithHMR(import.meta.hot, 'review', () =>
  create<ReviewState>()(
    withPersistence(
      (set, get) => ({
        active: null,
        sessions: {},

        startReview: (baseCommit, baseRef, tipSha, files) => {
          const prior = get().sessions[baseCommit]
          const active: ReviewSession = {
            baseCommit,
            baseRef,
            tipSha,
            startedAt: Date.now(),
            files,
            viewedFiles: prior ? new Set(prior.viewedFiles) : new Set(),
            comments: prior ? [...prior.comments] : [],
          }
          set({ active, sessions: persistActive(active, get().sessions) })
        },

        exitReview: () => set({ active: null }),

        setViewed: (filePath, viewed) => {
          const active = get().active
          if (!active) return
          const viewedFiles = new Set(active.viewedFiles)
          if (viewed) viewedFiles.add(filePath)
          else viewedFiles.delete(filePath)
          const next = { ...active, viewedFiles }
          set({ active: next, sessions: persistActive(next, get().sessions) })
        },
      }),
      {
        name: 'review',
        fields: {
          sessions: {
            scope: 'project',
            serialize: (v) => serializeSessions(v as Record<string, ReviewSession>),
            deserialize: (raw) => deserializeSessions(raw),
          },
        },
        debounce: 500,
      },
    ),
  ),
)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/store/review.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Export + register at startup**

In `src/store/index.ts` add:

```ts
export { useReviewStore } from './review'
```

In `src/hooks/useWindowLifecycle.ts`, add a side-effect import after line 14 (`import { useBrowserStore } from '@/store/browser'`) so the store registers with persistence before `initPersistence` runs:

```ts
import '@/store/review'
```

- [ ] **Step 6: Verify typecheck**

Run: `npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/store/review.ts src/store/review.test.ts src/store/index.ts src/hooks/useWindowLifecycle.ts
git commit -m "feat(review): add review store with session + viewed tracking"
```

---

### Task 3: Canvas `showRangeDiff` action + CodeNode review metadata

**Files:**
- Modify: `src/types/nodes.ts` (add `review?` field to the CodeNode data type)
- Modify: `src/store/canvas.ts` (add `showRangeDiff`; declare in the store interface near `showCommitDiff`)

First inspect `src/types/nodes.ts` to find the CodeNode data interface (fields `filePath`, `code`, `headOverride`, `readOnly`, `commitHash`). Add an optional review marker.

- [ ] **Step 1: Add the review marker to the CodeNode type**

In `src/types/nodes.ts`, in the CodeNode data interface (the one with `headOverride?` and `readOnly?`), add:

```ts
  /** Present when this node is a read-only commit-range review diff. */
  review?: { filePath: string } // repo-relative path under review
```

- [ ] **Step 2: Declare `showRangeDiff` in the canvas store interface**

In `src/store/canvas.ts`, find the interface line declaring
`showCommitDiff: (commitHash: string, filePath: string) => Promise<void>` and add directly below it:

```ts
  showRangeDiff: (filePath: string, base: string, head: string) => Promise<void>
```

- [ ] **Step 3: Implement `showRangeDiff`**

In `src/store/canvas.ts`, add this action immediately after the `showCommitDiff` action (after line 352). It mirrors `showCommitDiff` but takes explicit base/head and tags the node with `review`:

```ts
        showRangeDiff: async (filePath, base, head) => {
          const { columns } = get()
          const rootCol = columns[0]
          if (!rootCol) return
          const repoPath = rootCol.path

          let afterContent = ''
          try {
            afterContent = await invoke<string>('git_show_commit_file', {
              repoPath,
              hash: head,
              filePath,
            })
          } catch {
            /* file deleted in range — show empty after-content */
          }

          let beforeContent = ''
          try {
            beforeContent = await invoke<string>('git_show_commit_file', {
              repoPath,
              hash: base,
              filePath,
            })
          } catch {
            /* file added in range — no base content */
          }

          const fileName = filePath.split('/').pop() || filePath
          const lineCount = afterContent.split('\n').length
          const codeNode: AppNode = {
            id: `review:${repoPath}/${filePath}:${base}..${head}`,
            type: 'codeNode',
            position: { x: 0, y: 0 },
            data: {
              label: fileName,
              filePath: joinPath(repoPath, filePath),
              code: afterContent,
              startLine: 1,
              endLine: lineCount,
              headOverride: beforeContent,
              readOnly: true,
              review: { filePath },
            },
          }

          const previewCol: Column = {
            path: joinPath(repoPath, filePath),
            kind: 'file',
            nodes: [codeNode],
            edges: [],
          }

          set({
            columns: [...columns.slice(0, 1), previewCol],
            currentColumnIndex: 0,
            focusedNodeId: null,
            cameraY: CANVAS_MARGIN,
          })

          flattenAndRender(get, set)
        },
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/nodes.ts src/store/canvas.ts
git commit -m "feat(canvas): add showRangeDiff for read-only commit-range review"
```

---

### Task 4: History panel — "Review changes since this commit"

**Files:**
- Modify: `src/components/History/index.tsx`
- Modify: `src/store/view.ts` (no change expected; confirm `setViewMode('files')` exists — used to surface the Changes panel)

The action resolves base (`<hash>~1`, or empty-tree if the commit is the repo's root), snapshots the tip (`log[0].hash`), calls `git_diff_range`, starts the review, and switches to the Files view. The root commit is detected by checking whether `<hash>~1` resolves (the `git_diff_range` call against `<hash>~1` throws for the root; we catch and retry against the empty tree).

- [ ] **Step 1: Add imports and the action to `CommitEntry`**

At the top of `src/components/History/index.tsx`, extend imports:

```ts
import { useReviewStore } from '@/store/review'
import { useViewStore } from '@/store/view'
```

Add this constant near `LOG_PAGE_SIZE` (line 8):

```ts
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
```

Inside `CommitEntry`, after `handleFileClick` (line 19), add:

```ts
  const handleReview = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      const repoPath = useGitStore.getState().repoPath
      const tipSha = useGitStore.getState().log?.[0]?.hash
      if (!repoPath || !tipSha) return

      const fetchRange = (base: string) =>
        invoke<ReviewFile[]>('git_diff_range', { repoPath, base, head: tipSha })

      let baseRef = `${commit.hash}~1`
      let files: ReviewFile[]
      try {
        files = await fetchRange(baseRef)
      } catch {
        // Root commit: no parent — diff against the empty tree.
        baseRef = EMPTY_TREE
        try {
          files = await fetchRange(baseRef)
        } catch {
          return
        }
      }
      useReviewStore.getState().startReview(commit.hash, baseRef, tipSha, files)
      useViewStore.getState().setViewMode('files')
    },
    [commit.hash],
  )
```

Add `ReviewFile` to the review import:

```ts
import { useReviewStore, type ReviewFile } from '@/store/review'
```

- [ ] **Step 2: Add the button to the entry header**

In `CommitEntry`'s returned JSX, replace the header row (lines 35-38, the `<div>` containing `{commit.hash}` and `<RelativeTime/>`) with one that includes a hover-revealed review button:

```tsx
      <div className="flex items-center justify-between text-[10px] text-muted-foreground/50 font-mono">
        <span>{commit.hash}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReview}
            className="opacity-0 group-hover/commit:opacity-100 px-1 py-0.5 rounded hover:bg-primary/20 hover:text-primary transition-opacity cursor-pointer"
            title="Review this commit and everything since it (read-only)"
          >
            review
          </button>
          <RelativeTime timestamp={commit.timestamp} />
        </div>
      </div>
```

Add the `group/commit` class to the outer entry `<div>` (line 22-23): change `className="px-2 py-1.5 border-b border-border/10 hover:bg-muted/30 cursor-pointer"` to include `group/commit`:

```tsx
      className="group/commit px-2 py-1.5 border-b border-border/10 hover:bg-muted/30 cursor-pointer"
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `npx tsc -b --noEmit && npx eslint src/components/History/index.tsx`
Expected: no errors.

- [ ] **Step 4: Verify `setViewMode` signature**

Run: `grep -n "setViewMode" src/store/view.ts`
Expected: a `setViewMode: (mode: ...) => void` with `'files'` among the modes. If the mode name differs, adjust the `setViewMode('files')` call to the value that shows the Changes panel.

- [ ] **Step 5: Commit**

```bash
git add src/components/History/index.tsx
git commit -m "feat(history): add 'review since commit' action"
```

---

### Task 5: Changes panel — review mode (banner, file list, viewed checkboxes, exit)

**Files:**
- Modify: `src/components/Changes/index.tsx`

When `useReviewStore(s => s.active)` is set, the panel renders the review changeset instead of the live working-tree status: a banner with progress + Exit, and a flat file list where each row has a viewed checkbox and opens via `showRangeDiff`.

- [ ] **Step 1: Add imports**

At the top of `src/components/Changes/index.tsx` add:

```ts
import { useReviewStore, type ReviewFile, type ReviewSession } from '@/store/review'
```

- [ ] **Step 2: Add the review-mode file row component**

Add above the `Changes` component (after `TreeEntry`, line 116):

```tsx
const ReviewFileEntry = memo(function ReviewFileEntry({
  file,
  session,
}: {
  file: ReviewFile
  session: ReviewSession
}) {
  const viewed = session.viewedFiles.has(file.path)
  const commentCount = session.comments.filter((c) => c.filePath === file.path).length
  const open = () => {
    void useCanvasStore.getState().showRangeDiff(file.path, session.baseRef, session.tipSha)
  }
  return (
    <div
      className="flex items-center gap-2 px-2 py-px hover:bg-primary/10 cursor-pointer text-xs font-mono"
      onClick={open}
      title={file.path}
    >
      <input
        type="checkbox"
        checked={viewed}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => useReviewStore.getState().setViewed(file.path, e.target.checked)}
        className="shrink-0 cursor-pointer"
        title="Mark viewed"
      />
      <span
        className={`shrink-0 w-4 text-center ${statusColors[file.status] ?? 'text-muted-foreground'}`}
      >
        {file.status}
      </span>
      <span className={`truncate ${viewed ? 'text-muted-foreground/50 line-through' : ''}`}>
        {file.path.split('/').pop()}
      </span>
      {commentCount > 0 && (
        <span className="ml-auto shrink-0 text-[10px] text-primary">💬 {commentCount}</span>
      )}
    </div>
  )
})
```

- [ ] **Step 3: Render review mode in the `Changes` component**

In `src/components/Changes/index.tsx`, at the very start of the `Changes` function body (after the existing `useGitStore` selectors, ~line 123), add:

```tsx
  const review = useReviewStore((s) => s.active)
```

Then, immediately before the existing `if (!isGitRepo) return <NoGitRepo />` (line 150), add the review-mode branch:

```tsx
  if (review) {
    const viewedCount = review.files.filter((f) => review.viewedFiles.has(f.path)).length
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-2 py-1 text-[11px] border-b border-border/30 bg-primary/10">
          <span className="text-primary truncate" title={`Reviewing since ${review.baseCommit}`}>
            Review · {review.baseCommit.slice(0, 7)} · {viewedCount}/{review.files.length} viewed
          </span>
          <button
            onClick={() => useReviewStore.getState().exitReview()}
            className="px-1.5 py-0.5 rounded hover:bg-muted/50 font-mono text-[10px] cursor-pointer"
            title="Exit review"
          >
            Exit
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto py-1">
          {review.files.map((file) => (
            <ReviewFileEntry key={file.path} file={file} session={review} />
          ))}
        </div>
      </div>
    )
  }
```

- [ ] **Step 4: Verify typecheck + lint**

Run: `npx tsc -b --noEmit && npx eslint src/components/Changes/index.tsx`
Expected: no errors.

- [ ] **Step 5: Manual smoke test**

Run: `yarn tauri dev` (or the project's run command). In a repo with ≥2 commits: open History → hover a commit → click "review" → confirm the Changes panel shows the review banner and file list; toggle a viewed checkbox (count updates); click a file (read-only diff opens); click Exit (returns to live changes). Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/components/Changes/index.tsx
git commit -m "feat(changes): add read-only review mode with viewed tracking"
```

---

## Phase 2 — Comments + text export

### Task 6: Review store — comments + markdown export

**Files:**
- Modify: `src/store/review.ts`
- Modify: `src/store/review.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/store/review.test.ts`:

```ts
describe('review store — comments', () => {
  beforeEach(() => {
    useReviewStore.setState({ active: null, sessions: {} })
    useReviewStore.getState().startReview('abc1234', 'abc1234~1', 'tip999', files)
  })

  it('addComment adds a comment with a stable id and persists it', () => {
    const r = useReviewStore.getState()
    r.addComment('src/a.ts', 10, 12, 'const x = 1', 'use const-correct name')
    const c = useReviewStore.getState().active!.comments
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({
      filePath: 'src/a.ts',
      startLine: 10,
      endLine: 12,
      body: 'use const-correct name',
    })
    expect(c[0].id).toBeTruthy()
    expect(useReviewStore.getState().sessions['abc1234'].comments).toHaveLength(1)
  })

  it('updateComment and removeComment mutate by id', () => {
    const r = useReviewStore.getState()
    r.addComment('src/a.ts', 1, 1, 'x', 'first')
    const id = useReviewStore.getState().active!.comments[0].id
    r.updateComment(id, 'edited')
    expect(useReviewStore.getState().active!.comments[0].body).toBe('edited')
    r.removeComment(id)
    expect(useReviewStore.getState().active!.comments).toHaveLength(0)
  })

  it('exportCommentsMarkdown renders file:line + body', () => {
    const r = useReviewStore.getState()
    r.addComment('src/a.ts', 10, 12, 'const x = 1', 'rename x')
    const md = useReviewStore.getState().exportCommentsMarkdown()
    expect(md).toContain('src/a.ts:10-12')
    expect(md).toContain('rename x')
    expect(md).toContain('const x = 1')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/store/review.test.ts`
Expected: FAIL — `addComment`/`updateComment`/`removeComment`/`exportCommentsMarkdown` are not functions.

- [ ] **Step 3: Implement comment actions**

In `src/store/review.ts`, add to the `ReviewState` interface (after `setViewed`):

```ts
  addComment: (
    filePath: string,
    startLine: number,
    endLine: number,
    snippet: string,
    body: string,
  ) => void
  updateComment: (id: string, body: string) => void
  removeComment: (id: string) => void
  exportCommentsMarkdown: () => string
```

Add a tiny id helper above the store (below the imports):

```ts
let commentSeq = 0
function nextCommentId(): string {
  commentSeq += 1
  return `cmt_${Date.now().toString(36)}_${commentSeq}`
}
```

Add the action implementations inside the store creator, after `setViewed`:

```ts
        addComment: (filePath, startLine, endLine, snippet, body) => {
          const active = get().active
          if (!active) return
          const comment: ReviewComment = {
            id: nextCommentId(),
            filePath,
            startLine,
            endLine,
            snippet,
            body,
            createdAt: Date.now(),
          }
          const next = { ...active, comments: [...active.comments, comment] }
          set({ active: next, sessions: persistActive(next, get().sessions) })
        },

        updateComment: (id, body) => {
          const active = get().active
          if (!active) return
          const next = {
            ...active,
            comments: active.comments.map((c) => (c.id === id ? { ...c, body } : c)),
          }
          set({ active: next, sessions: persistActive(next, get().sessions) })
        },

        removeComment: (id) => {
          const active = get().active
          if (!active) return
          const next = { ...active, comments: active.comments.filter((c) => c.id !== id) }
          set({ active: next, sessions: persistActive(next, get().sessions) })
        },

        exportCommentsMarkdown: () => {
          const active = get().active
          if (!active || active.comments.length === 0) return ''
          const lines: string[] = [`## Review — commits since ${active.baseCommit.slice(0, 7)}`, '']
          const sorted = [...active.comments].sort(
            (a, b) =>
              a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine,
          )
          for (const c of sorted) {
            const range = c.startLine === c.endLine ? `${c.startLine}` : `${c.startLine}-${c.endLine}`
            lines.push(`### ${c.filePath}:${range}`)
            lines.push('```')
            lines.push(c.snippet)
            lines.push('```')
            lines.push(c.body)
            lines.push('')
          }
          return lines.join('\n')
        },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/store/review.test.ts`
Expected: PASS (all tests, Phase 1 + Phase 2).

- [ ] **Step 5: Commit**

```bash
git add src/store/review.ts src/store/review.test.ts
git commit -m "feat(review): add comments and markdown export"
```

---

### Task 7: CodeNode — create a comment from a selection (review nodes only)

**Files:**
- Modify: `src/components/Canvas/nodes/CodeNode.tsx`

Add a React overlay (matching the existing absolute-overlay style in this file) that appears when the user selects ≥1 line in a review CodeNode. It shows an "Add comment" affordance; submitting calls `addComment` with the selected line range, the selected text as `snippet`, and the typed body. Selection works even though the editor is `readOnly`.

- [ ] **Step 1: Add imports + review wiring**

Near the existing imports in `src/components/Canvas/nodes/CodeNode.tsx`, add:

```ts
import { useReviewStore } from '@/store/review'
```

Inside the component body (after the existing refs/state near line 196), add state to hold the current selection target:

```ts
  const reviewFilePath = data.review?.filePath
  const [commentDraft, setCommentDraft] = useState<{
    startLine: number
    endLine: number
    snippet: string
    top: number
  } | null>(null)
  const [commentBody, setCommentBody] = useState('')
```

- [ ] **Step 2: Detect selection in the editor update listener**

In the `EditorView.updateListener.of((update) => { ... })` block (lines 420-427), add selection handling at the end of the callback (still inside the listener). This computes the selected line range and the pixel top for the overlay, only for review nodes:

```ts
            if (reviewFilePath && update.selectionSet) {
              const sel = update.state.selection.main
              if (sel.empty) {
                setCommentDraft(null)
              } else {
                const doc = update.state.doc
                const startLine = doc.lineAt(sel.from).number
                const endLine = doc.lineAt(sel.to).number
                const snippet = update.state.sliceDoc(
                  doc.line(startLine).from,
                  doc.line(endLine).to,
                )
                const top = update.view.coordsAtPos(doc.line(startLine).from)
                const scrollTop = update.view.scrollDOM.scrollTop
                const editorTop = update.view.scrollDOM.getBoundingClientRect().top
                setCommentDraft({
                  startLine,
                  endLine,
                  snippet,
                  top: top ? top.top - editorTop + scrollTop : 0,
                })
              }
            }
```

Note: `reviewFilePath` is captured in the editor-effect closure. The editor effect's dependency array (`[data.code, data.filePath, data.startLine]`, line 569) does not include it; that is fine because review nodes have a unique `id`/`data.code` and are never reconfigured into non-review nodes — the node is recreated when content changes.

- [ ] **Step 3: Render the comment-draft overlay**

In the JSX, inside the `<div className="relative overflow-hidden flex-1 min-w-0">` block (after the editor `<div ref={editorRef} .../>`, around line 798), add:

```tsx
          {reviewFilePath && commentDraft && (
            <div
              className="absolute right-2 z-20 w-64 rounded border border-border bg-background shadow-lg p-2 pointer-events-auto"
              style={{ top: commentDraft.top }}
            >
              <div className="text-[10px] text-muted-foreground mb-1 font-mono">
                Lines {commentDraft.startLine}
                {commentDraft.endLine !== commentDraft.startLine ? `–${commentDraft.endLine}` : ''}
              </div>
              <textarea
                autoFocus
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Comment for the agent…"
                className="w-full h-16 text-xs bg-muted/40 rounded p-1 outline-none resize-none"
              />
              <div className="flex justify-end gap-1 mt-1">
                <button
                  type="button"
                  onClick={() => {
                    setCommentDraft(null)
                    setCommentBody('')
                  }}
                  className="text-[10px] px-1.5 py-0.5 rounded hover:bg-muted cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!commentBody.trim()}
                  onClick={() => {
                    useReviewStore
                      .getState()
                      .addComment(
                        reviewFilePath,
                        commentDraft.startLine,
                        commentDraft.endLine,
                        commentDraft.snippet,
                        commentBody.trim(),
                      )
                    setCommentDraft(null)
                    setCommentBody('')
                  }}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary disabled:opacity-40 cursor-pointer"
                >
                  Comment
                </button>
              </div>
            </div>
          )}
```

- [ ] **Step 4: Verify typecheck + lint**

Run: `npx tsc -b --noEmit && npx eslint src/components/Canvas/nodes/CodeNode.tsx`
Expected: no errors.

- [ ] **Step 5: Manual smoke test**

Run the app, start a review, open a file, select one or more lines → the comment box appears → type and click Comment → the Changes panel file row shows a 💬 count (verified fully in Task 9). Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/components/Canvas/nodes/CodeNode.tsx
git commit -m "feat(review): add comment-on-selection to review diff nodes"
```

---

### Task 8: CodeNode — highlight commented lines

**Files:**
- Modify: `src/components/Canvas/nodes/cmPlugins.ts` (add a decoration extension)
- Modify: `src/components/Canvas/nodes/CodeNode.tsx` (apply it for review nodes; refresh on comment changes)

Use a CodeMirror `StateField` + `StateEffect` that paints a line background on commented ranges. The CodeNode pushes the current comment line-ranges into the editor via the effect whenever the review store's comments for this file change.

- [ ] **Step 1: Add the decoration extension**

Append to `src/components/Canvas/nodes/cmPlugins.ts`:

```ts
import { StateField, StateEffect, type Extension, type Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView as CMEditorView } from '@codemirror/view'

export const setCommentRanges = StateEffect.define<{ from: number; to: number }[]>()

const commentLineDeco = Decoration.line({ class: 'cm-cotectCommentLine' })

export const commentHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setCommentRanges)) {
        const maxLine = tr.state.doc.lines
        const ranges = e.value
          .map((r) => ({ from: Math.min(r.from, maxLine), to: Math.min(r.to, maxLine) }))
          .sort((a, b) => a.from - b.from)
        const decos: Range<Decoration>[] = []
        for (const r of ranges) {
          for (let ln = r.from; ln <= r.to; ln++) {
            decos.push(commentLineDeco.range(tr.state.doc.line(ln).from))
          }
        }
        deco = Decoration.set(decos, true)
      }
    }
    return deco
  },
  provide: (f) => CMEditorView.decorations.from(f),
})

export const commentHighlightTheme: Extension = CMEditorView.theme({
  '.cm-cotectCommentLine': {
    backgroundColor: 'rgba(250, 204, 21, 0.10)',
    boxShadow: 'inset 2px 0 0 rgba(250, 204, 21, 0.6)',
  },
})
```

- [ ] **Step 2: Add the extension to review editors**

In `src/components/Canvas/nodes/CodeNode.tsx`, import the new symbols (extend the existing `./cmPlugins` import at lines 37-43):

```ts
import {
  rainbowBrackets,
  buildMergeExtension,
  getChunks,
  acceptChunk,
  rejectChunk,
  commentHighlightField,
  commentHighlightTheme,
  setCommentRanges,
} from './cmPlugins'
```

In the `EditorState.create({ extensions: [...] })` list, add (right after `rainbowBrackets,` at line 415) the highlight extensions only when this is a review node:

```ts
          ...(reviewFilePath ? [commentHighlightField, commentHighlightTheme] : []),
```

- [ ] **Step 3: Push comment ranges into the editor when they change**

Subscribe to this file's comments and dispatch the effect. Add this selector near the other store selectors in the component body:

```ts
  const fileComments = useReviewStore((s) =>
    reviewFilePath
      ? (s.active?.comments.filter((c) => c.filePath === reviewFilePath) ?? [])
      : [],
  )
```

Add an effect (after the editor-creation effect, near the other `useEffect`s ~line 586):

```ts
  useEffect(() => {
    if (!reviewFilePath) return
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: setCommentRanges.of(
        fileComments.map((c) => ({ from: c.startLine, to: c.endLine })),
      ),
    })
  }, [reviewFilePath, fileComments, editorReady])
```

- [ ] **Step 4: Verify typecheck + lint**

Run: `npx tsc -b --noEmit && npx eslint src/components/Canvas/nodes/cmPlugins.ts src/components/Canvas/nodes/CodeNode.tsx`
Expected: no errors. (Remove the unused `builder` placeholder if eslint flags it — it is only there to avoid an empty block; delete the two `builder` lines if needed.)

- [ ] **Step 5: Manual smoke test**

Run the app, add a comment in a review file → the commented lines get a yellow tint + left bar. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/components/Canvas/nodes/cmPlugins.ts src/components/Canvas/nodes/CodeNode.tsx
git commit -m "feat(review): highlight commented lines in review diffs"
```

---

### Task 9: Changes panel — comments list + Copy all (clipboard)

**Files:**
- Modify: `src/components/Changes/index.tsx`

Add a comments section below the review file list: each comment shows `file:line`, body (editable), a remove button, and clicking it opens that file and (best-effort) reveals the line. A "Copy all" button writes `exportCommentsMarkdown()` to the clipboard. This is the text-only action seam.

- [ ] **Step 1: Add a comments-list section to review mode**

In `src/components/Changes/index.tsx`, inside the `if (review) { ... }` block from Task 5, replace the single scrollable file-list `<div>` with a file list plus a comments section:

```tsx
        <div className="flex-1 min-h-0 overflow-y-auto py-1">
          {review.files.map((file) => (
            <ReviewFileEntry key={file.path} file={file} session={review} />
          ))}
          {review.comments.length > 0 && (
            <div className="mt-2 border-t border-border/30 pt-1">
              <div className="flex items-center justify-between px-2 py-1 text-[10px] text-muted-foreground/60">
                <span>
                  {review.comments.length} comment{review.comments.length !== 1 ? 's' : ''}
                </span>
                <button
                  onClick={() => {
                    const md = useReviewStore.getState().exportCommentsMarkdown()
                    void navigator.clipboard.writeText(md)
                  }}
                  className="px-1.5 py-0.5 rounded hover:bg-muted/50 font-mono text-[10px] cursor-pointer"
                  title="Copy all comments as markdown"
                >
                  Copy all
                </button>
              </div>
              {review.comments.map((c) => (
                <div
                  key={c.id}
                  className="px-2 py-1 text-[11px] hover:bg-muted/20 cursor-pointer"
                  onClick={() =>
                    useCanvasStore
                      .getState()
                      .showRangeDiff(c.filePath, review.baseRef, review.tipSha)
                  }
                >
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground/60 font-mono">
                    <span className="truncate">
                      {c.filePath.split('/').pop()}:{c.startLine}
                      {c.endLine !== c.startLine ? `-${c.endLine}` : ''}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        useReviewStore.getState().removeComment(c.id)
                      }}
                      className="px-1 rounded hover:bg-red-900/40 hover:text-red-400 cursor-pointer"
                      title="Delete comment"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-0.5 break-words">{c.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>
```

- [ ] **Step 2: Verify typecheck + lint**

Run: `npx tsc -b --noEmit && npx eslint src/components/Changes/index.tsx`
Expected: no errors.

- [ ] **Step 3: Manual smoke test**

Run the app: start a review, add 2 comments in different files, confirm they list at the bottom of the Changes panel with correct `file:line`; click one (file opens); click Copy all and paste into a text editor — confirm the markdown matches `## Review …` / `### path:line` / fenced snippet / body. Delete a comment (row disappears, 💬 count updates). Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/components/Changes/index.tsx
git commit -m "feat(changes): list review comments with markdown copy-out"
```

---

### Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full JS test suite**

Run: `npx vitest run`
Expected: PASS, including `src/store/review.test.ts`.

- [ ] **Step 2: Run the Rust tests**

Run: `cd tauri && cargo test`
Expected: PASS, including `git_diff_range_*`.

- [ ] **Step 3: Typecheck + lint the whole project**

Run: `npx tsc -b --noEmit && npx eslint src`
Expected: no errors.

- [ ] **Step 4: End-to-end manual check**

Run the app and verify the full loop: History → review a commit → Changes shows review mode → mark files viewed (progress updates) → open files (read-only diffs) → select lines and comment (lines highlight, 💬 counts) → Copy all (markdown on clipboard) → Exit review (live working-tree Changes return, agents' real changes unaffected). Confirm `git reflog`/`git status` show **no** new commits or working-tree changes caused by reviewing.

- [ ] **Step 5: Final commit (if any stray changes)**

```bash
git add -A
git commit -m "chore(review): final verification pass" || echo "nothing to commit"
```

---

## Self-review notes (addressed)

- **Spec coverage:** read-only range diff (Task 1), tip snapshot + session (Task 2), read-only diff view reuse (Task 3), History entry + root-commit/empty-tree handling (Tasks 1/4), Changes review mode + viewed progress (Task 5), GitHub-style per-file viewed + line-range comments (Tasks 5/6/7), comment highlight (Task 8), comments list + text/clipboard export seam (Task 9), per-project persistence with Set/array (de)serialization (Task 2), non-destructive verification (Task 10). Agent integration intentionally out of scope per spec.
- **Type consistency:** `ReviewFile`/`ReviewComment`/`ReviewSession` and actions `startReview/exitReview/setViewed/addComment/updateComment/removeComment/exportCommentsMarkdown` are defined in Task 2/6 and used consistently in Tasks 4/5/7/9; `showRangeDiff(filePath, base, head)` signature is consistent across Tasks 3/5/9; `setCommentRanges`/`commentHighlightField`/`commentHighlightTheme` defined in Task 8 and imported there.
- **Drift handling:** `snippet` is stored for context and future stale-detection; v1 displays comments by stored line range. (Spec lists explicit stale-marking as a v1 nicety; can be layered on later without schema change since `snippet` is already persisted.)
```
