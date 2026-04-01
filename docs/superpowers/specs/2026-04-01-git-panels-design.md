# Git Panels & File Watcher Design

## Overview

Add git integration to Cotect: working tree status, commit history, branch info, and a top-bar summary. Backed by a general-purpose filesystem watcher that drives reactive updates.

## Rust Backend

### Git Commands (`src-tauri/src/git.rs`)

All commands shell out to `git` and parse stdout. Each receives `repo_path: String` and returns `Result<T, String>`.

**`git_status(repo_path)`**
Runs `git status --porcelain` and `git diff --numstat` (plus `--cached` variant).
Returns:
```
{
  files: [{ path: String, status: "M"|"A"|"D"|"R"|"??", insertions: u32, deletions: u32 }],
  total_insertions: u32,
  total_deletions: u32
}
```

**`git_log(repo_path, limit)`**
Runs `git log` with a custom format and `--numstat`. Default limit 50.
Returns:
```
[{
  hash: String,
  message: String,
  author: String,
  timestamp: i64,       // unix seconds
  insertions: u32,
  deletions: u32,
  files: [{ path: String, status: "M"|"A"|"D"|"R" }]
}]
```

**`git_branch(repo_path)`**
Runs `git rev-parse --abbrev-ref HEAD`.
Returns:
```
{ current: String }
```
Minimal for now. Will expand to include worktree/multi-branch info later.

**`git_last_commit_time(repo_path)`**
Runs `git log -1 --format=%ct`.
Returns: `i64` (unix timestamp), or error if no commits exist.

**`git_init(repo_path)`**
Runs `git init`. Returns `Result<(), String>`.

### File Watcher (`src-tauri/src/watcher.rs`)

New dependency: `notify` crate v7.

**`watch_path(path, id, recursive)`**
Starts watching a filesystem path. Emits Tauri events named `fs-changed` with payload:
```
{ id: String, paths: [String], kind: "create"|"modify"|"delete" }
```
Debounces at 300ms to batch rapid changes (e.g. a single `git commit` touches many `.git/` files).

**`unwatch_path(id)`**
Stops and removes a watcher by its ID.

Multiple watchers can coexist with different IDs. The watcher is general-purpose infrastructure — git is the first consumer, but source file watching for canvas refresh will use the same system.

## Frontend Store

### `src/store/git.ts`

Regular Zustand store (not synced across windows — git state is per-machine).

**State:**
- `repoPath: string` — mirrors `useBrowserStore.rootPath`
- `isGitRepo: boolean`
- `status: { files, totalInsertions, totalDeletions } | null`
- `log: Commit[] | null`
- `branch: { current } | null`
- `lastCommitTimestamp: number | null`
- `loading: boolean`

**Actions:**
- `refresh()` — fetches all four git commands in parallel via `Promise.all`. On error (not a git repo), sets `isGitRepo: false` and nulls everything.
- `initRepo()` — calls `git_init`, then `refresh()`.

**Refresh triggers:**
- On `openRoot` (folder opened) — subscribe to `useBrowserStore.rootPath`
- On `fs-changed` events where `id === "git"` — watcher on `.git/`
- On window focus — catches external changes

**Watcher lifecycle:**
- When `rootPath` changes: `unwatch_path("git")`, then `watch_path(rootPath + "/.git", "git", true)`
- On cleanup (window close): `unwatch_path("git")`

## UI Components

### Top Bar Git Stats

Right-aligned section in the existing `TopBar` component.
Format: `+47 -12 · 4m ago`
- Green `+N` for insertions, red `-N` for deletions
- Relative time since last commit, updates every minute
- Hidden entirely when `isGitRepo` is false or no project is open

### Changes Panel (`src/components/Changes/index.tsx`)

Compact directory tree of modified files.

**Tree construction:**
- Group files by directory path
- Collapse single-child directories into one line (e.g. `src/store/` instead of nested `src/ > store/`)
- Root-level files shown without indentation

**Per-file display:**
- Status icon: M (yellow), A (green), D (red), ?? (gray)
- Filename
- Right-aligned per-file `+N -N` stats

**Header:** "Changes (N files)" count.

**Not-a-repo state:** Centered "Not a git repository" message with "Initialize Repository" button.

### History Panel (`src/components/History/index.tsx`)

Scrollable list of commits.

**Per-commit display:**
- Short hash (7 chars) and relative time on the first line
- Commit message
- `+N -N · K files` stats line

**Expandable:** Clicking a commit toggles a file list showing which files were touched.

**Pagination:** Loads 50 commits initially. Loads more on scroll-to-bottom (infinite scroll).

**Not-a-repo state:** Same as Changes panel.

### Branches Panel (`src/components/Branches/index.tsx`)

Minimal placeholder for future multi-worktree support.

**Display:** Green dot + current branch name.

**Not-a-repo state:** Same as Changes panel.

## Panel Registration

### New Panel Definitions

Added to `PANEL_DEFINITIONS` in `src/store/layout.ts`:
```
{ id: 'changes',  label: 'Changes',  defaultPosition: 'left' }
{ id: 'history',  label: 'History',  defaultPosition: 'left' }
{ id: 'branches', label: 'Branches', defaultPosition: 'left' }
```

Added to `PANEL_CONTENT` in `src/components/Layout/PanelArea.tsx`.

### Default Layout

`DEFAULT_MAIN_LAYOUT` updated: Changes panel appears by default in the left zone as a tab alongside Explorer. History and Branches available from View menu but not shown by default.

### Fallback Positions for Child Windows

Child windows have no bottom zone. `PanelDefinition` gains an optional `fallbackPosition` field:
```
{ id: 'console',  defaultPosition: 'bottom', fallbackPosition: 'right' }
{ id: 'timeline', defaultPosition: 'bottom', fallbackPosition: 'right' }
```

When `addPanel` is called in a child window (panel mode), if `defaultPosition` is `'bottom'`, use `fallbackPosition` instead. Panels without `fallbackPosition` use their default.

## Error Handling

- **Git not installed:** Git commands fail to spawn. The Rust side detects this (spawn error vs nonzero exit) and returns a distinct error string. Frontend sets `isGitRepo: false` and shows "Git not found" instead of the init button.
- **Not a git repo:** `git status` exits with code 128. Panels show "Initialize Repository" button.
- **Empty repo (no commits):** `git_log` and `git_last_commit_time` return empty/error. History shows "No commits yet". Top bar stats hidden.
- **Watcher fails to start:** Log warning, fall back to window-focus-only refresh. Git features still work, just not reactive.
