# Per-Hunk Review — Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rework the already-built commit-review feature from per-file "viewed" granularity to **per-change-hunk** review: each hunk can be accepted or commented, with progress tracked per hunk.

**Architecture:** git is the single source of hunks (`git_diff_range` now returns each file's after-side hunk ranges). The review store tracks `acceptedHunks` (a Set) and hunk-anchored comments; a hunk is "reviewed" when accepted OR commented. In the read-only diff, a CodeMirror **gutter marker** sits on each hunk's start line (state: none/accepted/commented); clicking it opens a small popover (Accept toggle + comment box). The Changes panel shows per-file and overall hunk progress.

**Tech Stack:** Tauri/Rust, React/TS, zustand (+withPersistence), CodeMirror 6, Vitest, cargo test.

**Spec:** `docs/superpowers/specs/2026-06-03-commit-review-comments-design.md` (revised).

**Convention:** IPC structs use snake_case (matches existing `GitStatus.total_insertions`), so the new hunk field is `start_line`/`line_count` on both sides. No `Co-Authored-By` trailers.

---

### Task R1: Rust — `git_diff_range` returns per-file hunks

**Files:** `tauri/src/git.rs` (+ tests). `main.rs` registration already exists — no change.

- [ ] **Step 1: Update the failing tests**

In `tauri/src/git.rs` `mod tests`, REPLACE the existing `git_diff_range_lists_changes_between_two_commits` and `git_diff_range_against_empty_tree_is_all_additions` test bodies' assertions to also check hunks, and keep `git_diff_range_rename_with_edit_keeps_counts`. Replace those two tests with:

```rust
    #[tokio::test]
    async fn git_diff_range_lists_changes_between_two_commits() {
        let (_dir, repo) = make_repo();
        write_and_commit(&repo, "a.txt", "one\n", "c1");
        write_and_commit(&repo, "a.txt", "one\ntwo\n", "c2");
        write_and_commit(&repo, "b.txt", "new\n", "c3");

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
        assert!(!a.hunks.is_empty(), "a.txt should have at least one hunk");
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
        assert_eq!(files[0].hunks.len(), 1);
        assert_eq!(files[0].hunks[0].start_line, 1);
        assert_eq!(files[0].hunks[0].line_count, 2);
    }

    #[tokio::test]
    async fn git_diff_range_reports_multiple_hunks() {
        let (_dir, repo) = make_repo();
        let ten = (1..=10).map(|n| format!("line{n}\n")).collect::<String>();
        write_and_commit(&repo, "a.txt", &ten, "c1");
        // Edit line 1 and line 10 — two separated hunks.
        let edited = "EDITED1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nEDITED10\n";
        write_and_commit(&repo, "a.txt", edited, "c2");

        let files = git_diff_range(repo.clone(), "HEAD~1".to_string(), "HEAD".to_string())
            .await
            .unwrap();
        let a = files.iter().find(|f| f.path == "a.txt").unwrap();
        assert_eq!(a.hunks.len(), 2, "expected two separate hunks, got {:?}", a.hunks);
    }
```

(Keep the existing `git_diff_range_rename_with_edit_keeps_counts` test; it asserts `f.status == "R"` and `f.insertions >= 1`, both still valid on the new struct.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tauri && cargo test git_diff_range`
Expected: FAIL — `no field hunks on type ...` (struct lacks `hunks`).

- [ ] **Step 3: Add the hunk struct, range-file struct, and parser; rewrite `git_diff_range`**

In `tauri/src/git.rs`, add near `GitFileStatus` (after its definition ~line 70):

```rust
#[derive(Serialize)]
pub struct GitHunk {
    pub start_line: u32, // after-side first line (the `c` of `+c,d`)
    pub line_count: u32, // after-side line count (`d`); 0 for pure deletions
}

#[derive(Serialize)]
pub struct GitRangeFile {
    pub path: String,
    pub status: String,
    pub insertions: u32,
    pub deletions: u32,
    pub hunks: Vec<GitHunk>,
}

/// Parse after-side hunk ranges per file from a `git diff` patch.
/// Tracks the current file from `+++ b/<path>` lines and reads `@@ ... +c,d @@`.
fn parse_diff_hunks(patch: &str) -> std::collections::HashMap<String, Vec<GitHunk>> {
    let mut map: std::collections::HashMap<String, Vec<GitHunk>> =
        std::collections::HashMap::new();
    let mut current: Option<String> = None;
    for line in patch.lines() {
        if let Some(rest) = line.strip_prefix("+++ ") {
            if rest == "/dev/null" {
                current = None;
            } else {
                // Strip a leading `b/` (git's default dst prefix).
                current = Some(rest.strip_prefix("b/").unwrap_or(rest).to_string());
            }
            continue;
        }
        if line.starts_with("@@ ") {
            // Format: @@ -a,b +c,d @@ (b and d optional, default 1)
            if let Some(path) = &current {
                if let Some(plus) = line.split('+').nth(1) {
                    let nums = plus.split('@').next().unwrap_or("").trim();
                    let mut parts = nums.split(',');
                    let start = parts.next().and_then(|s| s.trim().parse::<u32>().ok());
                    let count = parts
                        .next()
                        .and_then(|s| s.trim().parse::<u32>().ok())
                        .unwrap_or(1);
                    if let Some(start_line) = start {
                        map.entry(path.clone()).or_default().push(GitHunk {
                            start_line,
                            line_count: count,
                        });
                    }
                }
            }
        }
    }
    map
}
```

Then REPLACE the existing `git_diff_range` function body so it returns `Vec<GitRangeFile>` and attaches hunks:

```rust
#[tauri::command]
pub async fn git_diff_range(
    repo_path: String,
    base: String,
    head: String,
) -> Result<Vec<GitRangeFile>, String> {
    let range_base = base.as_str();
    let range_head = head.as_str();

    let numstat = run_git(
        &repo_path,
        &["diff", "--numstat", "--no-renames", range_base, range_head],
    )
    .await
    .unwrap_or_default();
    let name_status =
        run_git(&repo_path, &["diff", "--name-status", range_base, range_head]).await?;
    let patch = run_git(
        &repo_path,
        &["diff", "--no-renames", range_base, range_head],
    )
    .await
    .unwrap_or_default();

    let stats = parse_numstat(&numstat);
    let mut hunks_by_path = parse_diff_hunks(&patch);

    let mut files = Vec::new();
    for line in name_status.lines() {
        let mut parts = line.split('\t');
        let code = match parts.next() {
            Some(c) if !c.is_empty() => c,
            _ => continue,
        };
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
        let hunks = hunks_by_path.remove(&path).unwrap_or_default();
        files.push(GitRangeFile {
            path,
            status,
            insertions,
            deletions,
            hunks,
        });
    }

    Ok(files)
}
```

- [ ] **Step 4: Run tests + build**

Run: `cd tauri && cargo test git_diff_range`
Expected: PASS (4 tests). Then `cd tauri && cargo build 2>&1 | tail -3` — clean.

- [ ] **Step 5: Commit**

```bash
git add tauri/src/git.rs
git commit -m "feat(git): return per-file hunks from git_diff_range"
```

---

### Task R2: Review store — per-hunk state

**Files:** `src/store/review.ts`, `src/store/review.test.ts`.

- [ ] **Step 1: Rewrite the store tests for per-hunk model**

Replace the entire contents of `src/store/review.test.ts` with:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  useReviewStore,
  hunkReviewed,
  fileProgress,
  overallProgress,
  type ReviewFile,
} from './review'

const files: ReviewFile[] = [
  {
    path: 'src/a.ts',
    status: 'M',
    insertions: 3,
    deletions: 1,
    hunks: [
      { start_line: 10, line_count: 2 },
      { start_line: 40, line_count: 1 },
    ],
  },
  {
    path: 'src/b.ts',
    status: 'A',
    insertions: 5,
    deletions: 0,
    hunks: [{ start_line: 1, line_count: 5 }],
  },
]

beforeEach(() => {
  useReviewStore.setState({ active: null, sessions: {} })
  useReviewStore.getState().startReview('abc1234', 'abc1234~1', 'tip999', files)
})

describe('review store — per-hunk', () => {
  it('startReview seeds an active session with files+hunks', () => {
    const s = useReviewStore.getState().active!
    expect(s.files).toEqual(files)
    expect(s.acceptedHunks.size).toBe(0)
    expect(s.comments).toEqual([])
  })

  it('acceptHunk / unacceptHunk toggle and persist', () => {
    const r = useReviewStore.getState()
    r.acceptHunk('src/a.ts', 10)
    expect(useReviewStore.getState().active!.acceptedHunks.has('src/a.ts:10')).toBe(true)
    expect(useReviewStore.getState().sessions['abc1234'].acceptedHunks.has('src/a.ts:10')).toBe(true)
    r.unacceptHunk('src/a.ts', 10)
    expect(useReviewStore.getState().active!.acceptedHunks.has('src/a.ts:10')).toBe(false)
  })

  it('a hunk is reviewed when accepted OR commented', () => {
    const r = useReviewStore.getState()
    let s = useReviewStore.getState().active!
    expect(hunkReviewed(s, 'src/a.ts', 10)).toBe(false)
    r.acceptHunk('src/a.ts', 10)
    s = useReviewStore.getState().active!
    expect(hunkReviewed(s, 'src/a.ts', 10)).toBe(true)
    r.addComment('src/a.ts', 40, 40, 'code', 'fix this')
    s = useReviewStore.getState().active!
    expect(hunkReviewed(s, 'src/a.ts', 40)).toBe(true)
  })

  it('fileProgress and overallProgress count reviewed hunks', () => {
    const r = useReviewStore.getState()
    r.acceptHunk('src/a.ts', 10)
    r.addComment('src/a.ts', 40, 40, 'code', 'note')
    const s = useReviewStore.getState().active!
    expect(fileProgress(s, files[0])).toEqual({ reviewed: 2, total: 2 })
    expect(fileProgress(s, files[1])).toEqual({ reviewed: 0, total: 1 })
    expect(overallProgress(s)).toEqual({ reviewed: 2, total: 3 })
  })

  it('exportCommentsMarkdown renders path:range + body + snippet', () => {
    useReviewStore.getState().addComment('src/a.ts', 10, 11, 'const x = 1', 'rename x')
    const md = useReviewStore.getState().exportCommentsMarkdown()
    expect(md).toContain('src/a.ts:10-11')
    expect(md).toContain('rename x')
    expect(md).toContain('const x = 1')
  })

  it('re-entering restores accepted hunks + comments with fresh tip', () => {
    const r = useReviewStore.getState()
    r.acceptHunk('src/b.ts', 1)
    r.exitReview()
    expect(useReviewStore.getState().active).toBeNull()
    r.startReview('abc1234', 'abc1234~1', 'tipNEW', files)
    const s = useReviewStore.getState().active!
    expect(s.tipSha).toBe('tipNEW')
    expect(s.acceptedHunks.has('src/b.ts:1')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/store/review.test.ts`
Expected: FAIL — exports/actions (`hunkReviewed`, `acceptHunk`, `hunks`, …) don't exist yet.

- [ ] **Step 3: Rewrite `src/store/review.ts`**

Replace the whole file with:

```ts
import { create } from 'zustand'
import { createStoreWithHMR } from '@/lib/hmr'
import { withPersistence } from '@/store/persistence'

export interface ReviewHunk {
  start_line: number // after-side, 1-based
  line_count: number
}

export interface ReviewFile {
  path: string // repo-relative
  status: string // 'M' | 'A' | 'D' | 'R' | 'U'
  insertions: number
  deletions: number
  hunks: ReviewHunk[]
}

export interface ReviewComment {
  id: string
  filePath: string // repo-relative
  startLine: number // hunk start line in the after snapshot
  endLine: number
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

interface PersistedSession extends Omit<ReviewSession, 'acceptedHunks'> {
  acceptedHunks: string[]
}

export function hunkKey(filePath: string, startLine: number): string {
  return `${filePath}:${startLine}`
}

export function hunkReviewed(
  session: ReviewSession,
  filePath: string,
  startLine: number,
): boolean {
  if (session.acceptedHunks.has(hunkKey(filePath, startLine))) return true
  return session.comments.some((c) => c.filePath === filePath && c.startLine === startLine)
}

export function fileProgress(
  session: ReviewSession,
  file: ReviewFile,
): { reviewed: number; total: number } {
  const reviewed = file.hunks.filter((h) => hunkReviewed(session, file.path, h.start_line)).length
  return { reviewed, total: file.hunks.length }
}

export function overallProgress(session: ReviewSession): { reviewed: number; total: number } {
  let reviewed = 0
  let total = 0
  for (const f of session.files) {
    const p = fileProgress(session, f)
    reviewed += p.reviewed
    total += p.total
  }
  return { reviewed, total }
}

interface ReviewState {
  active: ReviewSession | null
  sessions: Record<string, ReviewSession>
  startReview: (baseCommit: string, baseRef: string, tipSha: string, files: ReviewFile[]) => void
  exitReview: () => void
  acceptHunk: (filePath: string, startLine: number) => void
  unacceptHunk: (filePath: string, startLine: number) => void
  addComment: (
    filePath: string,
    startLine: number,
    endLine: number,
    snippet: string,
    body: string,
  ) => void
  removeComment: (id: string) => void
  exportCommentsMarkdown: () => string
}

function serializeSessions(
  sessions: Record<string, ReviewSession>,
): Record<string, PersistedSession> {
  const out: Record<string, PersistedSession> = {}
  for (const [k, s] of Object.entries(sessions)) {
    out[k] = { ...s, acceptedHunks: [...s.acceptedHunks] }
  }
  return out
}

function deserializeSessions(raw: unknown): Record<string, ReviewSession> {
  const out: Record<string, ReviewSession> = {}
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, PersistedSession>)) {
      out[k] = {
        ...v,
        baseCommit: v.baseCommit ?? k,
        baseRef: v.baseRef ?? '',
        tipSha: v.tipSha ?? '',
        startedAt: v.startedAt ?? 0,
        files: v.files ?? [],
        acceptedHunks: new Set(v.acceptedHunks ?? []),
        comments: v.comments ?? [],
      }
    }
  }
  return out
}

let commentSeq = 0
function nextCommentId(): string {
  commentSeq += 1
  return `cmt_${Date.now().toString(36)}_${commentSeq}`
}

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
            acceptedHunks: prior ? new Set(prior.acceptedHunks) : new Set(),
            comments: prior ? [...prior.comments] : [],
          }
          set({ active, sessions: persistActive(active, get().sessions) })
        },

        exitReview: () => set({ active: null }),

        acceptHunk: (filePath, startLine) => {
          const active = get().active
          if (!active) return
          const acceptedHunks = new Set(active.acceptedHunks)
          acceptedHunks.add(hunkKey(filePath, startLine))
          const next = { ...active, acceptedHunks }
          set({ active: next, sessions: persistActive(next, get().sessions) })
        },

        unacceptHunk: (filePath, startLine) => {
          const active = get().active
          if (!active) return
          const acceptedHunks = new Set(active.acceptedHunks)
          acceptedHunks.delete(hunkKey(filePath, startLine))
          const next = { ...active, acceptedHunks }
          set({ active: next, sessions: persistActive(next, get().sessions) })
        },

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
            (a, b) => a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine,
          )
          for (const c of sorted) {
            const range =
              c.startLine === c.endLine ? `${c.startLine}` : `${c.startLine}-${c.endLine}`
            lines.push(`### ${c.filePath}:${range}`)
            lines.push('```')
            lines.push(c.snippet)
            lines.push('```')
            lines.push(c.body)
            lines.push('')
          }
          return lines.join('\n')
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

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/store/review.test.ts && npx tsc -b --noEmit`
Expected: tests PASS (6); tsc will FAIL in OTHER files (History/Changes/CodeNode still use `setViewed`/`viewedFiles`/`ReviewFile` without hunks) — that is expected and fixed in R3–R5. Confirm the review.test.ts passes; note the remaining tsc errors are only in those three files.

- [ ] **Step 5: Commit**

```bash
git add src/store/review.ts src/store/review.test.ts
git commit -m "feat(review): reshape store to per-hunk accept/comment state"
```

---

### Task R3: cmPlugins — review hunk gutter

**File:** `src/components/Canvas/nodes/cmPlugins.ts`.

The file already imports from `@codemirror/state` (`RangeSet`, `RangeSetBuilder`, `StateField`, `StateEffect`, `type Extension`, `type Range`) and `@codemirror/view` (`EditorView`, `Decoration`, `type DecorationSet`). Verify and add `gutter, GutterMarker` to the `@codemirror/view` import. `RangeSet` is already imported from state.

- [ ] **Step 1: Append the gutter extension**

Append to `src/components/Canvas/nodes/cmPlugins.ts`:

```ts
export type HunkDisplay = {
  startLine: number
  endLine: number
  state: 'none' | 'accepted' | 'commented'
}

export const setReviewHunks = StateEffect.define<HunkDisplay[]>()
export const openHunkActions = StateEffect.define<{ startLine: number; endLine: number }>()

export const reviewHunkField = StateField.define<HunkDisplay[]>({
  create() {
    return []
  },
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setReviewHunks)) return e.value
    return value
  },
})

class HunkMarker extends GutterMarker {
  constructor(readonly state: HunkDisplay['state']) {
    super()
  }
  eq(other: HunkMarker) {
    return other.state === this.state
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = `cm-cotectHunkMark cm-cotectHunkMark-${this.state}`
    el.textContent = this.state === 'accepted' ? '✓' : this.state === 'commented' ? '💬' : '•'
    el.title = 'Review this hunk'
    return el
  }
}

export const reviewHunkGutter = gutter({
  class: 'cm-cotectHunkGutter',
  markers: (view) => {
    const hunks = view.state.field(reviewHunkField, false) ?? []
    const maxLine = view.state.doc.lines
    const marks = hunks
      .map((h) => ({
        pos: view.state.doc.line(Math.max(1, Math.min(h.startLine, maxLine))).from,
        state: h.state,
      }))
      .sort((a, b) => a.pos - b.pos)
      .map((m) => new HunkMarker(m.state).range(m.pos))
    return RangeSet.of(marks, true)
  },
  initialSpacer: () => new HunkMarker('none'),
  domEventHandlers: {
    mousedown(view, line) {
      const lineNo = view.state.doc.lineAt(line.from).number
      const hunks = view.state.field(reviewHunkField, false) ?? []
      const hunk = hunks.find((h) => h.startLine === lineNo)
      if (!hunk) return false
      view.dispatch({
        effects: openHunkActions.of({ startLine: hunk.startLine, endLine: hunk.endLine }),
      })
      return true
    },
  },
})

export const reviewHunkTheme: Extension = EditorView.theme({
  '.cm-cotectHunkGutter': {
    width: '16px',
    cursor: 'pointer',
  },
  '.cm-cotectHunkMark': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    width: '16px',
    opacity: '0.85',
  },
  '.cm-cotectHunkMark-none': { color: 'rgba(255,255,255,0.35)' },
  '.cm-cotectHunkMark-accepted': { color: '#22c55e' },
  '.cm-cotectHunkMark-commented': { color: '#fbbf24' },
})
```

NOTE: if `gutter`/`GutterMarker` are not yet imported, add them to the EXISTING `@codemirror/view` import line. If `RangeSet` is not in the existing `@codemirror/state` import, add it there. Do NOT create duplicate import lines.

- [ ] **Step 2: Verify typecheck (cmPlugins only) + lint**

Run: `npx eslint src/components/Canvas/nodes/cmPlugins.ts`
Expected: clean. (Full `tsc` still has expected errors in R4/R5 files.)

- [ ] **Step 3: Commit**

```bash
git add src/components/Canvas/nodes/cmPlugins.ts
git commit -m "feat(review): add per-hunk review gutter to cmPlugins"
```

---

### Task R4: CodeNode — wire hunk gutter + accept/comment popover

**File:** `src/components/Canvas/nodes/CodeNode.tsx`.

- [ ] **Step 1: Extend the cmPlugins import**

The existing import block from `./cmPlugins` includes `commentHighlightField, commentHighlightTheme, setCommentRanges`. Add to it:

```ts
  reviewHunkField,
  reviewHunkGutter,
  reviewHunkTheme,
  setReviewHunks,
  openHunkActions,
```

- [ ] **Step 2: Add review-state selectors**

Near the existing `fileComments` selector (around line 243), add:

```ts
  const reviewHunks = useReviewStore(
    useShallow((s) =>
      reviewFilePath ? (s.active?.files.find((f) => f.path === reviewFilePath)?.hunks ?? []) : [],
    ),
  )
  const acceptedStartLines = useReviewStore(
    useShallow((s) => {
      if (!reviewFilePath || !s.active) return [] as number[]
      const prefix = `${reviewFilePath}:`
      return [...s.active.acceptedHunks]
        .filter((k) => k.startsWith(prefix))
        .map((k) => Number(k.slice(prefix.length)))
    }),
  )
```

(`fileComments` already gives the commented hunks' start lines via `c.startLine`.)

- [ ] **Step 3: Add the hunk extensions to the editor**

Change the existing review-only extension line (currently
`...(reviewFilePath ? [commentHighlightField, commentHighlightTheme] : [])`) to:

```ts
          ...(reviewFilePath
            ? [
                commentHighlightField,
                commentHighlightTheme,
                reviewHunkField,
                reviewHunkGutter,
                reviewHunkTheme,
              ]
            : []),
```

- [ ] **Step 4: Replace the selection handler with hunk-action handling**

In the `EditorView.updateListener.of((update) => {...})`, DELETE the entire
`if (reviewFilePath && update.selectionSet) { ... }` block (the one that calls
`setCommentDraft` from a selection). Replace it with this hunk-action handler:

```ts
            if (reviewFilePath) {
              for (const tr of update.transactions) {
                for (const e of tr.effects) {
                  if (e.is(openHunkActions)) {
                    const { startLine, endLine } = e.value
                    const doc = update.state.doc
                    const safeEnd = Math.min(endLine, doc.lines)
                    const snippet = update.state.sliceDoc(
                      doc.line(startLine).from,
                      doc.line(safeEnd).to,
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
                    setCommentBody('')
                  }
                }
              }
            }
```

- [ ] **Step 5: Push hunk display state into the editor**

Add a new effect after the existing `setCommentRanges` effect (the one near line 631). Keep the existing `setCommentRanges` effect as-is (it tints commented lines). Add:

```ts
  useEffect(() => {
    if (!reviewFilePath) return
    const view = viewRef.current
    if (!view) return
    const accepted = new Set(acceptedStartLines)
    const commented = new Set(fileComments.map((c) => c.startLine))
    const display = reviewHunks.map((h) => ({
      startLine: h.start_line,
      endLine: h.line_count > 0 ? h.start_line + h.line_count - 1 : h.start_line,
      state: accepted.has(h.start_line)
        ? ('accepted' as const)
        : commented.has(h.start_line)
          ? ('commented' as const)
          : ('none' as const),
    }))
    view.dispatch({ effects: setReviewHunks.of(display) })
  }, [reviewFilePath, reviewHunks, acceptedStartLines, fileComments, editorReady])
```

- [ ] **Step 6: Add an Accept toggle to the comment popover**

In the comment-draft overlay JSX (the `{reviewFilePath && commentDraft && ( ... )}` block), add an Accept toggle row ABOVE the `<textarea>`. Insert this right after the `Lines {commentDraft.startLine}…` header `<div>`:

```tsx
              <button
                type="button"
                onClick={() => {
                  const accepted = acceptedStartLines.includes(commentDraft.startLine)
                  if (accepted)
                    useReviewStore.getState().unacceptHunk(reviewFilePath, commentDraft.startLine)
                  else useReviewStore.getState().acceptHunk(reviewFilePath, commentDraft.startLine)
                }}
                className={`w-full mb-1 text-[10px] px-1.5 py-0.5 rounded font-mono cursor-pointer ${
                  acceptedStartLines.includes(commentDraft.startLine)
                    ? 'bg-green-900/40 text-green-400'
                    : 'bg-muted hover:bg-muted/70'
                }`}
              >
                {acceptedStartLines.includes(commentDraft.startLine) ? '✓ Accepted' : 'Accept hunk'}
              </button>
```

The existing Comment button already calls `addComment(reviewFilePath, commentDraft.startLine, commentDraft.endLine, snippet, body)` — leave it; it now anchors to the hunk. (Verify the existing Comment button passes `commentDraft.startLine`/`endLine`/`snippet`; it does.)

- [ ] **Step 7: Verify typecheck + lint**

Run: `npx tsc -b --noEmit && npx eslint src/components/Canvas/nodes/CodeNode.tsx`
Expected: CodeNode errors gone. (Changes panel still errs until R5.)

- [ ] **Step 8: Commit**

```bash
git add src/components/Canvas/nodes/CodeNode.tsx
git commit -m "feat(review): per-hunk gutter + accept/comment popover in CodeNode"
```

---

### Task R5: Changes panel — per-hunk progress

**File:** `src/components/Changes/index.tsx`.

- [ ] **Step 1: Update imports + ReviewFileEntry**

Change the review import to add the progress helpers:

```ts
import {
  useReviewStore,
  fileProgress,
  overallProgress,
  type ReviewFile,
  type ReviewSession,
} from '@/store/review'
```

Replace the `ReviewFileEntry` component with a per-hunk-progress version (no checkbox; show `reviewed/total`):

```tsx
const ReviewFileEntry = memo(function ReviewFileEntry({
  file,
  session,
}: {
  file: ReviewFile
  session: ReviewSession
}) {
  const { reviewed, total } = fileProgress(session, file)
  const done = total > 0 && reviewed === total
  const open = () => {
    void useCanvasStore.getState().showRangeDiff(file.path, session.baseRef, session.tipSha)
  }
  return (
    <div
      className="flex items-center gap-2 px-2 py-px hover:bg-primary/10 cursor-pointer text-xs font-mono"
      onClick={open}
      title={file.path}
    >
      <span
        className={`shrink-0 w-4 text-center ${statusColors[file.status] ?? 'text-muted-foreground'}`}
      >
        {file.status}
      </span>
      <span className={`truncate ${done ? 'text-muted-foreground/50' : ''}`}>
        {file.path.split('/').pop()}
      </span>
      <span
        className={`ml-auto shrink-0 text-[10px] ${done ? 'text-green-500' : 'text-muted-foreground/60'}`}
      >
        {reviewed}/{total}
      </span>
    </div>
  )
})
```

- [ ] **Step 2: Update the review banner to overall hunk progress**

In the `if (review) { ... }` block, replace the `viewedCount` line and the banner `<span>` text. Replace:

```tsx
    const viewedCount = review.files.filter((f) => review.viewedFiles.has(f.path)).length
```
with:
```tsx
    const progress = overallProgress(review)
```

And replace the banner label span text:
```tsx
            Review · {review.baseCommit.slice(0, 7)} · {viewedCount}/{review.files.length} viewed
```
with:
```tsx
            Review · {review.baseCommit.slice(0, 7)} · {progress.reviewed}/{progress.total} hunks
```

(Leave the file list `.map(ReviewFileEntry)` and the comments list / Copy-all section unchanged.)

- [ ] **Step 3: Verify the whole project**

Run: `npx tsc -b --noEmit && npx eslint src && npx vitest run`
Expected: all clean / all pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/Changes/index.tsx
git commit -m "feat(changes): per-hunk review progress in Changes panel"
```

---

### Task R6: Final verification

- [ ] **Step 1:** `npx vitest run` → all pass.
- [ ] **Step 2:** `cd tauri && cargo test` → all pass.
- [ ] **Step 3:** `npx tsc -b --noEmit && npx eslint src` → clean.
- [ ] **Step 4 (manual, human):** run the app; review a multi-hunk file; confirm a gutter marker per hunk, clicking opens the popover, Accept turns the marker green ✓, Comment turns it amber 💬, per-file `reviewed/total` and the banner total update, Copy-all yields markdown, and nothing mutates git/working tree.

## Self-review notes
- **Coverage:** hunks from git (R1), store per-hunk state + helpers (R2), gutter (R3), CodeNode wiring incl. removal of selection-based commenting (R4), Changes per-hunk progress (R5). `git_diff_range` return type changed `GitFileStatus`→`GitRangeFile`; History's `invoke<ReviewFile[]>` still works because `ReviewFile` now matches the new shape (path/status/insertions/deletions/hunks).
- **Type consistency:** `ReviewHunk` uses snake_case `start_line`/`line_count` end-to-end (IPC convention). `acceptHunk/unacceptHunk(filePath, startLine)`, `addComment(filePath, startLine, endLine, snippet, body)`, helpers `hunkReviewed/fileProgress/overallProgress`, and cmPlugins exports `setReviewHunks/openHunkActions/reviewHunkField/reviewHunkGutter/reviewHunkTheme/HunkDisplay` are used consistently across R2–R5.
- **Ordering:** R2 leaves the tree un-typechecking until R4/R5 land (History/Changes/CodeNode reference removed `setViewed`/`viewedFiles`); this is expected and called out per task. Full green only after R5.
- **History panel:** unchanged — `git_diff_range` returns the richer shape and `startReview(...)` is unchanged.
```
