# Git Panels & File Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add git integration panels (changes, history, branches), a top-bar git summary, and a general-purpose filesystem watcher to Cotect.

**Architecture:** Rust backend shells out to `git` CLI and parses output into typed structs. A `notify`-based file watcher emits Tauri events on `.git/` changes. Frontend Zustand store consumes these events and drives three new dockable panels plus a top-bar status indicator.

**Tech Stack:** Rust (`notify` v7, `std::process::Command`), Tauri v2 commands/events, Zustand, React, Tailwind CSS, Lucide icons.

---

### Task 1: Add `notify` dependency and create file watcher module

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/watcher.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add `notify` to Cargo.toml**

In `src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
notify = { version = "7", features = ["macos_fsevent"] }
notify-debouncer-full = "0.4"
```

- [ ] **Step 2: Create `src-tauri/src/watcher.rs`**

```rust
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebouncedEvent, Debouncer, FileIdMap};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Clone)]
struct FsChangedPayload {
    id: String,
    paths: Vec<String>,
    kind: String,
}

struct WatcherEntry {
    _debouncer: Debouncer<notify::RecommendedWatcher, FileIdMap>,
}

pub struct WatcherState {
    watchers: Mutex<HashMap<String, WatcherEntry>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }
}

fn event_kind_str(kind: &notify::EventKind) -> &'static str {
    use notify::EventKind::*;
    match kind {
        Create(_) => "create",
        Modify(_) => "modify",
        Remove(_) => "delete",
        _ => "modify",
    }
}

#[tauri::command]
pub fn watch_path(
    app: AppHandle,
    path: String,
    id: String,
    recursive: bool,
) -> Result<(), String> {
    let state = app.state::<WatcherState>();
    let mut watchers = state.watchers.lock().map_err(|e| e.to_string())?;

    // Remove existing watcher with this id
    watchers.remove(&id);

    let watch_id = id.clone();
    let app_handle = app.clone();

    let debouncer = new_debouncer(
        Duration::from_millis(300),
        None,
        move |result: Result<Vec<DebouncedEvent>, Vec<notify::Error>>| {
            let events = match result {
                Ok(events) => events,
                Err(_) => return,
            };

            let mut paths: Vec<String> = Vec::new();
            let mut kind = "modify";

            for event in &events {
                kind = event_kind_str(&event.event.kind);
                for p in &event.event.paths {
                    paths.push(p.to_string_lossy().to_string());
                }
            }

            paths.sort();
            paths.dedup();

            if !paths.is_empty() {
                let _ = app_handle.emit(
                    "fs-changed",
                    FsChangedPayload {
                        id: watch_id.clone(),
                        paths,
                        kind: kind.to_string(),
                    },
                );
            }
        },
    )
    .map_err(|e| format!("Failed to create watcher: {e}"))?;

    let mode = if recursive {
        RecursiveMode::Recursive
    } else {
        RecursiveMode::NonRecursive
    };

    debouncer
        .watch(PathBuf::from(&path), mode)
        .map_err(|e| format!("Failed to watch path: {e}"))?;

    watchers.insert(id, WatcherEntry { _debouncer: debouncer });

    Ok(())
}

#[tauri::command]
pub fn unwatch_path(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<WatcherState>();
    let mut watchers = state.watchers.lock().map_err(|e| e.to_string())?;
    watchers.remove(&id);
    Ok(())
}
```

- [ ] **Step 3: Register watcher module and commands in `main.rs`**

Add `mod watcher;` alongside `mod commands;`. Add `WatcherState` as managed state. Register the two new commands:

```rust
mod commands;
mod watcher;

// ... existing code ...

fn main() {
    tauri::Builder::default()
        .manage(watcher::WatcherState::new())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::read_directory,
            commands::read_file_content,
            commands::is_wayland,
            commands::get_cursor_window,
            commands::get_window_monitor,
            commands::set_window_on_monitor,
            commands::get_monitors,
            watcher::watch_path,
            watcher::unwatch_path,
        ])
        // ... rest unchanged ...
}
```

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/watcher.rs src-tauri/src/main.rs
git commit -m "feat: add filesystem watcher infrastructure using notify crate"
```

---

### Task 2: Create git commands Rust module

**Files:**
- Create: `src-tauri/src/git.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Create `src-tauri/src/git.rs`**

```rust
use serde::Serialize;
use std::collections::HashMap;
use std::process::Command;

const GIT_NOT_FOUND: &str = "GIT_NOT_FOUND";
const NOT_A_REPO: &str = "NOT_A_REPO";

fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(["-C", repo_path])
        .args(args)
        .output()
        .map_err(|_| GIT_NOT_FOUND.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if stderr.contains("not a git repository") {
            Err(NOT_A_REPO.to_string())
        } else {
            Err(stderr)
        }
    }
}

#[derive(Serialize)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
    pub insertions: u32,
    pub deletions: u32,
}

#[derive(Serialize)]
pub struct GitStatus {
    pub files: Vec<GitFileStatus>,
    pub total_insertions: u32,
    pub total_deletions: u32,
}

#[tauri::command]
pub fn git_status(repo_path: String) -> Result<GitStatus, String> {
    let porcelain = run_git(&repo_path, &["status", "--porcelain"])?;
    let numstat = run_git(&repo_path, &["diff", "--numstat"]).unwrap_or_default();
    let cached_numstat = run_git(&repo_path, &["diff", "--cached", "--numstat"]).unwrap_or_default();

    let mut stats: HashMap<String, (u32, u32)> = HashMap::new();
    for line in numstat.lines().chain(cached_numstat.lines()) {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() == 3 {
            let ins = parts[0].parse::<u32>().unwrap_or(0);
            let del = parts[1].parse::<u32>().unwrap_or(0);
            let entry = stats.entry(parts[2].to_string()).or_insert((0, 0));
            entry.0 += ins;
            entry.1 += del;
        }
    }

    let mut files = Vec::new();
    let mut total_insertions = 0u32;
    let mut total_deletions = 0u32;

    for line in porcelain.lines() {
        if line.len() < 4 {
            continue;
        }
        let status_code = line[..2].trim();
        let path = line[3..].to_string();
        let status = match status_code {
            "M" | "MM" | "AM" => "M",
            "A" => "A",
            "D" => "D",
            "R" | "RM" => "R",
            "??" => "??",
            _ => "M",
        }
        .to_string();

        let (ins, del) = stats.get(&path).copied().unwrap_or((0, 0));
        total_insertions += ins;
        total_deletions += del;

        files.push(GitFileStatus {
            path,
            status,
            insertions: ins,
            deletions: del,
        });
    }

    Ok(GitStatus {
        files,
        total_insertions,
        total_deletions,
    })
}

#[derive(Serialize)]
pub struct GitLogFile {
    pub path: String,
    pub insertions: u32,
    pub deletions: u32,
}

#[derive(Serialize)]
pub struct GitLogEntry {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub timestamp: i64,
    pub insertions: u32,
    pub deletions: u32,
    pub files: Vec<GitLogFile>,
}

#[tauri::command]
pub fn git_log(repo_path: String, limit: Option<u32>) -> Result<Vec<GitLogEntry>, String> {
    let limit_str = format!("-{}", limit.unwrap_or(50));
    let output = run_git(
        &repo_path,
        &[
            "log",
            &limit_str,
            "--format=%H%n%s%n%an%n%ct%n---END---",
            "--numstat",
        ],
    )?;

    let mut entries = Vec::new();
    let mut lines = output.lines().peekable();

    while lines.peek().is_some() {
        let hash = match lines.next() {
            Some(h) if !h.is_empty() => h.to_string(),
            _ => break,
        };
        let message = lines.next().unwrap_or("").to_string();
        let author = lines.next().unwrap_or("").to_string();
        let timestamp: i64 = lines
            .next()
            .unwrap_or("0")
            .parse()
            .unwrap_or(0);

        // Skip the "---END---" marker
        lines.next();

        let mut files = Vec::new();
        let mut total_ins = 0u32;
        let mut total_del = 0u32;

        // Read numstat lines until empty line or next commit
        while let Some(line) = lines.peek() {
            if line.is_empty() {
                lines.next();
                break;
            }
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() == 3 {
                let ins = parts[0].parse::<u32>().unwrap_or(0);
                let del = parts[1].parse::<u32>().unwrap_or(0);
                total_ins += ins;
                total_del += del;
                files.push(GitLogFile {
                    path: parts[2].to_string(),
                    insertions: ins,
                    deletions: del,
                });
            }
            lines.next();
        }

        entries.push(GitLogEntry {
            hash: hash[..7.min(hash.len())].to_string(),
            message,
            author,
            timestamp,
            insertions: total_ins,
            deletions: total_del,
            files,
        });
    }

    Ok(entries)
}

#[derive(Serialize)]
pub struct GitBranch {
    pub current: String,
}

#[tauri::command]
pub fn git_branch(repo_path: String) -> Result<GitBranch, String> {
    let output = run_git(&repo_path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    Ok(GitBranch {
        current: output.trim().to_string(),
    })
}

#[tauri::command]
pub fn git_last_commit_time(repo_path: String) -> Result<i64, String> {
    let output = run_git(&repo_path, &["log", "-1", "--format=%ct"])?;
    output
        .trim()
        .parse::<i64>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_init(repo_path: String) -> Result<(), String> {
    run_git(&repo_path, &["init"]).map(|_| ())
}
```

- [ ] **Step 2: Register git module and commands in `main.rs`**

Add `mod git;` and register all five commands:

```rust
mod commands;
mod git;
mod watcher;
```

Add to `invoke_handler`:

```rust
git::git_status,
git::git_log,
git::git_branch,
git::git_last_commit_time,
git::git_init,
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/git.rs src-tauri/src/main.rs
git commit -m "feat: add git commands module (status, log, branch, init)"
```

---

### Task 3: Create git Zustand store

**Files:**
- Create: `src/store/git.ts`

- [ ] **Step 1: Create `src/store/git.ts`**

```typescript
import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface GitFileStatus {
  path: string
  status: string
  insertions: number
  deletions: number
}

export interface GitStatus {
  files: GitFileStatus[]
  total_insertions: number
  total_deletions: number
}

export interface GitLogFile {
  path: string
  insertions: number
  deletions: number
}

export interface GitLogEntry {
  hash: string
  message: string
  author: string
  timestamp: number
  insertions: number
  deletions: number
  files: GitLogFile[]
}

export interface GitBranch {
  current: string
}

type GitError = 'GIT_NOT_FOUND' | 'NOT_A_REPO' | 'NO_COMMITS' | null

interface GitState {
  repoPath: string
  isGitRepo: boolean
  gitError: GitError
  status: GitStatus | null
  log: GitLogEntry[] | null
  branch: GitBranch | null
  lastCommitTimestamp: number | null
  loading: boolean
  refresh: () => Promise<void>
  initRepo: () => Promise<void>
  setRepoPath: (path: string) => void
}

export const useGitStore = create<GitState>((set, get) => ({
  repoPath: '',
  isGitRepo: false,
  gitError: null,
  status: null,
  log: null,
  branch: null,
  lastCommitTimestamp: null,
  loading: false,

  refresh: async () => {
    const { repoPath } = get()
    if (!repoPath) return

    set({ loading: true })

    try {
      const [status, log, branch, lastCommitTime] = await Promise.allSettled([
        invoke<GitStatus>('git_status', { repoPath }),
        invoke<GitLogEntry[]>('git_log', { repoPath, limit: 50 }),
        invoke<GitBranch>('git_branch', { repoPath }),
        invoke<number>('git_last_commit_time', { repoPath }),
      ])

      if (status.status === 'rejected') {
        const err = String(status.reason)
        if (err.includes('GIT_NOT_FOUND')) {
          set({ isGitRepo: false, gitError: 'GIT_NOT_FOUND', status: null, log: null, branch: null, lastCommitTimestamp: null, loading: false })
          return
        }
        if (err.includes('NOT_A_REPO')) {
          set({ isGitRepo: false, gitError: 'NOT_A_REPO', status: null, log: null, branch: null, lastCommitTimestamp: null, loading: false })
          return
        }
      }

      set({
        isGitRepo: true,
        gitError: null,
        status: status.status === 'fulfilled' ? status.value : null,
        log: log.status === 'fulfilled' ? log.value : null,
        branch: branch.status === 'fulfilled' ? branch.value : null,
        lastCommitTimestamp: lastCommitTime.status === 'fulfilled' ? lastCommitTime.value : null,
        loading: false,
      })
    } catch {
      set({ loading: false })
    }
  },

  initRepo: async () => {
    const { repoPath } = get()
    if (!repoPath) return
    await invoke('git_init', { repoPath })
    await get().refresh()
  },

  setRepoPath: (path: string) => {
    set({ repoPath: path, isGitRepo: false, gitError: null, status: null, log: null, branch: null, lastCommitTimestamp: null })
  },
}))

let watcherCleanup: (() => void) | null = null

export function startGitWatcher(repoPath: string): void {
  stopGitWatcher()

  const cleanups: (() => void)[] = []

  // Watch .git/ for changes
  invoke('watch_path', { path: `${repoPath}/.git`, id: 'git', recursive: true }).catch(() => {
    console.warn('Failed to start git watcher, falling back to focus-only refresh')
  })
  cleanups.push(() => {
    invoke('unwatch_path', { id: 'git' }).catch(() => {})
  })

  // Listen for fs-changed events from the watcher
  let unlisten: UnlistenFn | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  listen('fs-changed', (event) => {
    const payload = event.payload as { id: string }
    if (payload.id === 'git') {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        useGitStore.getState().refresh()
      }, 200)
    }
  }).then((fn) => { unlisten = fn })
  cleanups.push(() => {
    unlisten?.()
    if (debounceTimer) clearTimeout(debounceTimer)
  })

  // Refresh on window focus
  const onFocus = () => { useGitStore.getState().refresh() }
  window.addEventListener('focus', onFocus)
  cleanups.push(() => window.removeEventListener('focus', onFocus))

  watcherCleanup = () => {
    for (const fn of cleanups) fn()
  }
}

export function stopGitWatcher(): void {
  watcherCleanup?.()
  watcherCleanup = null
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/store/git.ts
git commit -m "feat: add git Zustand store with watcher integration"
```

---

### Task 4: Wire git store into window lifecycle

**Files:**
- Modify: `src/hooks/useWindowLifecycle.ts`

- [ ] **Step 1: Import git store functions**

Add at the top of `useWindowLifecycle.ts`:

```typescript
import { useGitStore, startGitWatcher, stopGitWatcher } from '@/store/git'
```

- [ ] **Step 2: Start git watcher after session restoration**

In the main async effect, after `startSessionPersistence()` is called (inside the `if (isMain)` block), add:

```typescript
        // Start git integration
        if (session?.rootPath) {
          useGitStore.getState().setRepoPath(session.rootPath)
          startGitWatcher(session.rootPath)
          useGitStore.getState().refresh()
        }
```

Also subscribe to rootPath changes so git refreshes when the user opens a new folder. Add after the git watcher start:

```typescript
        useBrowserStore.subscribe((state) => {
          const gitState = useGitStore.getState()
          if (state.rootPath && state.rootPath !== gitState.repoPath) {
            gitState.setRepoPath(state.rootPath)
            stopGitWatcher()
            startGitWatcher(state.rootPath)
            gitState.refresh()
          }
        })
```

- [ ] **Step 3: Stop git watcher on cleanup**

In the cleanup effect (the one that calls `stopLayoutPersistence`, etc.), add `stopGitWatcher()`:

```typescript
  useEffect(() => {
    return platform.windows.onClose(() => {
      stopLayoutPersistence()
      stopGeometryPersistence()
      stopSessionPersistence()
      stopAllSyncedStores()
      stopGitWatcher()
      if (!isMain) removeLayout(windowId)
      if (isMain) platform.windows.closeAll()
      platform.ipc.emit('window-closed', { windowId }).catch(() => {})
    })
  }, [])

  useEffect(() => {
    return () => {
      stopLayoutPersistence()
      stopGeometryPersistence()
      stopSessionPersistence()
      stopGitWatcher()
    }
  }, [])
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useWindowLifecycle.ts
git commit -m "feat: wire git store and watcher into window lifecycle"
```

---

### Task 5: Add git stats to top bar

**Files:**
- Modify: `src/components/Layout/TopBar.tsx`

- [ ] **Step 1: Add git stats display to TopBar**

Import the git store and add a `useEffect` for relative time updates. Add the stats element right-aligned in the Menubar:

At the top, add:

```typescript
import { useGitStore } from '@/store/git'
import { useState, useEffect } from 'react'
```

Inside the `TopBar` component, before the `return`, add:

```typescript
  const isGitRepo = useGitStore((s) => s.isGitRepo)
  const totalInsertions = useGitStore((s) => s.status?.total_insertions ?? 0)
  const totalDeletions = useGitStore((s) => s.status?.total_deletions ?? 0)
  const lastCommitTimestamp = useGitStore((s) => s.lastCommitTimestamp)

  const [relativeTime, setRelativeTime] = useState('')

  useEffect(() => {
    if (!lastCommitTimestamp) {
      setRelativeTime('')
      return
    }
    const update = () => {
      const seconds = Math.floor(Date.now() / 1000 - lastCommitTimestamp)
      if (seconds < 60) setRelativeTime(`${seconds}s ago`)
      else if (seconds < 3600) setRelativeTime(`${Math.floor(seconds / 60)}m ago`)
      else if (seconds < 86400) setRelativeTime(`${Math.floor(seconds / 3600)}h ago`)
      else setRelativeTime(`${Math.floor(seconds / 86400)}d ago`)
    }
    update()
    const timer = setInterval(update, 60_000)
    return () => clearInterval(timer)
  }, [lastCommitTimestamp])
```

In the JSX, add a `flex-1` spacer and the stats after the last `MenubarMenu` closing tag but before the closing `</Menubar>`:

```tsx
      <div className="flex-1" />
      {isGitRepo && (totalInsertions > 0 || totalDeletions > 0 || relativeTime) && (
        <div className="flex items-center gap-1.5 pr-2 text-xs font-mono select-none">
          {totalInsertions > 0 && <span className="text-green-500">+{totalInsertions}</span>}
          {totalDeletions > 0 && <span className="text-red-500">-{totalDeletions}</span>}
          {relativeTime && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-muted-foreground/60">{relativeTime}</span>
            </>
          )}
        </div>
      )}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Layout/TopBar.tsx
git commit -m "feat: add git stats (+/- lines, time since commit) to top bar"
```

---

### Task 6: Add panel fallback positions and register new panels

**Files:**
- Modify: `src/store/layout.ts`
- Modify: `src/lib/constants.ts`

- [ ] **Step 1: Add `fallbackPosition` to PanelDefinition and update definitions**

In `src/store/layout.ts`, update the `PanelDefinition` interface and the `PANEL_DEFINITIONS` array:

```typescript
export interface PanelDefinition {
  id: string
  label: string
  defaultPosition: PanelPosition
  fallbackPosition?: PanelPosition
}

export const PANEL_DEFINITIONS: PanelDefinition[] = [
  { id: 'explorer', label: 'Explorer', defaultPosition: 'left' },
  { id: 'changes', label: 'Changes', defaultPosition: 'left' },
  { id: 'history', label: 'History', defaultPosition: 'left' },
  { id: 'branches', label: 'Branches', defaultPosition: 'left' },
  { id: 'chat', label: 'Chat', defaultPosition: 'right' },
  { id: 'properties', label: 'Properties', defaultPosition: 'right' },
  { id: 'console', label: 'Console', defaultPosition: 'bottom', fallbackPosition: 'right' },
  { id: 'timeline', label: 'Timeline', defaultPosition: 'bottom', fallbackPosition: 'right' },
]
```

- [ ] **Step 2: Update `addPanel` to accept a mode parameter for fallback**

Add a `getEffectivePosition` helper and modify `addPanel`:

```typescript
export function getEffectivePosition(panelId: string, isChildWindow: boolean): PanelPosition {
  const def = PANEL_DEFINITIONS.find((d) => d.id === panelId)
  if (!def) return 'left'
  if (isChildWindow && def.defaultPosition === 'bottom' && def.fallbackPosition) {
    return def.fallbackPosition
  }
  return def.defaultPosition
}
```

- [ ] **Step 3: Update TopBar to use `getEffectivePosition`**

In `src/components/Layout/TopBar.tsx`, import the helper:

```typescript
import { useLayoutStore, loadLayoutIntoStore, PANEL_DEFINITIONS, getEffectivePosition } from '@/store/layout'
import { getPlatform } from '@/services/platform'
```

Update the `onCheckedChange` handler in the View menu to use it:

```typescript
onCheckedChange={() => {
  if (visible) {
    removePanel(def.id)
  } else {
    const isChild = getPlatform().windows.getWindowId() !== 'main'
    addPanel(def.id, getEffectivePosition(def.id, isChild))
  }
}}
```

- [ ] **Step 4: Update DEFAULT_MAIN_LAYOUT to include Changes**

In `src/lib/constants.ts`:

```typescript
export const DEFAULT_MAIN_LAYOUT: PersistedLayout = {
  panels: { left: [['explorer', 'changes']], right: [['chat']], bottom: [['console']] },
  sizes: { left: [1], right: [1], bottom: [1] },
  activeTab: {},
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/store/layout.ts src/lib/constants.ts src/components/Layout/TopBar.tsx
git commit -m "feat: add panel fallback positions and register git panels"
```

---

### Task 7: Create shared NoGitRepo component

**Files:**
- Create: `src/components/NoGitRepo.tsx`

- [ ] **Step 1: Create the shared empty state component**

```typescript
import { useGitStore } from '@/store/git'
import { Button } from '@/components/ui/button'

export default function NoGitRepo() {
  const gitError = useGitStore((s) => s.gitError)
  const initRepo = useGitStore((s) => s.initRepo)

  if (gitError === 'GIT_NOT_FOUND') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground text-sm">
        Git not found
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground text-sm">
      <span>Not a git repository</span>
      <Button size="sm" onClick={initRepo}>
        Initialize Repository
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/NoGitRepo.tsx
git commit -m "feat: add shared NoGitRepo empty state component"
```

---

### Task 8: Create Changes panel

**Files:**
- Create: `src/components/Changes/index.tsx`

- [ ] **Step 1: Create the Changes panel component**

```typescript
import { useMemo } from 'react'
import { useGitStore, type GitFileStatus } from '@/store/git'
import NoGitRepo from '@/components/NoGitRepo'

interface TreeNode {
  name: string
  path: string
  file?: GitFileStatus
  children: TreeNode[]
}

function buildCompactTree(files: GitFileStatus[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] }

  for (const file of files) {
    const parts = file.path.split('/')
    let current = root
    for (let i = 0; i < parts.length - 1; i++) {
      let child = current.children.find((c) => c.name === parts[i] && !c.file)
      if (!child) {
        child = { name: parts[i], path: parts.slice(0, i + 1).join('/'), children: [] }
        current.children.push(child)
      }
      current = child
    }
    current.children.push({
      name: parts[parts.length - 1],
      path: file.path,
      file,
      children: [],
    })
  }

  // Collapse single-child directories
  function collapse(node: TreeNode): TreeNode {
    node.children = node.children.map(collapse)
    if (!node.file && node.children.length === 1 && !node.children[0].file) {
      const child = node.children[0]
      return { ...child, name: `${node.name}/${child.name}` }
    }
    return node
  }

  return collapse(root).children
}

const statusColors: Record<string, string> = {
  M: 'text-yellow-500',
  A: 'text-green-500',
  D: 'text-red-500',
  R: 'text-blue-500',
  '??': 'text-muted-foreground',
}

function FileEntry({ file }: { file: GitFileStatus }) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-px hover:bg-muted/30 text-xs font-mono">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`shrink-0 w-4 text-center ${statusColors[file.status] ?? 'text-muted-foreground'}`}>
          {file.status}
        </span>
        <span className="truncate">{file.path.split('/').pop()}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0 text-[10px]">
        {file.insertions > 0 && <span className="text-green-500">+{file.insertions}</span>}
        {file.deletions > 0 && <span className="text-red-500">-{file.deletions}</span>}
      </div>
    </div>
  )
}

function TreeEntry({ node, depth }: { node: TreeNode; depth: number }) {
  if (node.file) {
    return (
      <div style={{ paddingLeft: depth * 12 }}>
        <FileEntry file={node.file} />
      </div>
    )
  }

  return (
    <>
      <div
        className="px-2 py-px text-[11px] text-muted-foreground/50 font-mono"
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        {node.name}/
      </div>
      {node.children.map((child) => (
        <TreeEntry key={child.path} node={child} depth={depth + 1} />
      ))}
    </>
  )
}

export default function Changes() {
  const isGitRepo = useGitStore((s) => s.isGitRepo)
  const status = useGitStore((s) => s.status)

  const tree = useMemo(
    () => (status ? buildCompactTree(status.files) : []),
    [status],
  )

  if (!isGitRepo) return <NoGitRepo />

  if (!status || status.files.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No changes
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {tree.map((node) => (
          <TreeEntry key={node.path} node={node} depth={0} />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Changes/index.tsx
git commit -m "feat: add Changes panel with compact directory tree"
```

---

### Task 9: Create History panel

**Files:**
- Create: `src/components/History/index.tsx`

- [ ] **Step 1: Create the History panel component**

```typescript
import { useState, useCallback, useRef, useEffect } from 'react'
import { useGitStore, type GitLogEntry } from '@/store/git'
import { invoke } from '@tauri-apps/api/core'
import NoGitRepo from '@/components/NoGitRepo'

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function CommitEntry({ commit }: { commit: GitLogEntry }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className="px-2 py-1.5 border-b border-border/10 hover:bg-muted/30 cursor-pointer"
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-center justify-between text-[10px] text-muted-foreground/50 font-mono">
        <span>{commit.hash}</span>
        <span>{formatRelativeTime(commit.timestamp)}</span>
      </div>
      <div className="text-xs mt-0.5 truncate">{commit.message}</div>
      <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground/50 font-mono">
        {commit.insertions > 0 && <span className="text-green-500">+{commit.insertions}</span>}
        {commit.deletions > 0 && <span className="text-red-500">-{commit.deletions}</span>}
        <span>· {commit.files.length} file{commit.files.length !== 1 ? 's' : ''}</span>
      </div>
      {expanded && commit.files.length > 0 && (
        <div className="mt-1.5 pl-2 border-l border-border/30 text-[10px] font-mono text-muted-foreground/70">
          {commit.files.map((f) => (
            <div key={f.path} className="flex items-center justify-between py-px">
              <span className="truncate">{f.path}</span>
              <div className="flex items-center gap-1 shrink-0 ml-2">
                {f.insertions > 0 && <span className="text-green-500">+{f.insertions}</span>}
                {f.deletions > 0 && <span className="text-red-500">-{f.deletions}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function History() {
  const isGitRepo = useGitStore((s) => s.isGitRepo)
  const log = useGitStore((s) => s.log)
  const repoPath = useGitStore((s) => s.repoPath)
  const [allCommits, setAllCommits] = useState<GitLogEntry[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Sync store log into local state (reset on new data)
  useEffect(() => {
    if (log) {
      setAllCommits(log)
      setHasMore(log.length >= 50)
    } else {
      setAllCommits([])
      setHasMore(false)
    }
  }, [log])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !repoPath) return
    setLoadingMore(true)
    try {
      const more = await invoke<GitLogEntry[]>('git_log', {
        repoPath,
        limit: 50,
        skip: allCommits.length,
      })
      if (more.length < 50) setHasMore(false)
      setAllCommits((prev) => [...prev, ...more])
    } catch {
      setHasMore(false)
    }
    setLoadingMore(false)
  }, [loadingMore, hasMore, repoPath, allCommits.length])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      loadMore()
    }
  }, [loadMore])

  if (!isGitRepo) return <NoGitRepo />

  if (allCommits.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No commits yet
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto"
        onScroll={handleScroll}
      >
        {allCommits.map((commit, i) => (
          <CommitEntry key={`${commit.hash}-${i}`} commit={commit} />
        ))}
        {loadingMore && (
          <div className="py-2 text-center text-xs text-muted-foreground">Loading...</div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add `skip` parameter to `git_log` Rust command**

In `src-tauri/src/git.rs`, update the `git_log` function signature and add `--skip`:

```rust
#[tauri::command]
pub fn git_log(repo_path: String, limit: Option<u32>, skip: Option<u32>) -> Result<Vec<GitLogEntry>, String> {
    let limit_str = format!("-{}", limit.unwrap_or(50));
    let mut args = vec![
        "log",
        &limit_str,
    ];
    let skip_str;
    if let Some(s) = skip {
        skip_str = format!("--skip={s}");
        args.push(&skip_str);
    }
    args.extend_from_slice(&["--format=%H%n%s%n%an%n%ct%n---END---", "--numstat"]);
    let output = run_git(&repo_path, &args)?;
```

Replace the first 10 lines of the existing `git_log` function body with this. The rest of the parsing logic stays the same.

- [ ] **Step 3: Verify both TypeScript and Rust compile**

Run: `npx tsc --noEmit` and `cd src-tauri && cargo check`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/History/index.tsx src-tauri/src/git.rs
git commit -m "feat: add History panel with expandable commits and infinite scroll"
```

---

### Task 10: Create Branches panel

**Files:**
- Create: `src/components/Branches/index.tsx`

- [ ] **Step 1: Create the Branches panel component**

```typescript
import { useGitStore } from '@/store/git'
import NoGitRepo from '@/components/NoGitRepo'

export default function Branches() {
  const isGitRepo = useGitStore((s) => s.isGitRepo)
  const branch = useGitStore((s) => s.branch)

  if (!isGitRepo) return <NoGitRepo />

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 text-sm font-mono">
        <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
        <span className="truncate">{branch?.current ?? 'unknown'}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Branches/index.tsx
git commit -m "feat: add Branches panel with current branch display"
```

---

### Task 11: Register panel components in PanelArea

**Files:**
- Modify: `src/components/Layout/PanelArea.tsx`

- [ ] **Step 1: Import and register the three new panel components**

Add imports at the top of `PanelArea.tsx`:

```typescript
import Changes from '@/components/Changes';
import History from '@/components/History';
import Branches from '@/components/Branches';
```

Update the `PANEL_CONTENT` map:

```typescript
const PANEL_CONTENT: Record<string, ComponentType> = {
  chat: Chat,
  console: Console,
  changes: Changes,
  history: History,
  branches: Branches,
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Layout/PanelArea.tsx
git commit -m "feat: register Changes, History, and Branches panels in PanelArea"
```

---

### Task 12: Full build verification

**Files:** None (verification only).

- [ ] **Step 1: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Vite build**

Run: `npx vite build`
Expected: builds successfully.

- [ ] **Step 3: Rust check**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors.

- [ ] **Step 4: Full Tauri build test**

Run: `cd src-tauri && cargo build`
Expected: compiles successfully (including linking with notify).

- [ ] **Step 5: Commit any fixes if needed, then final commit**

If all checks pass with no changes needed:

```bash
git log --oneline -12
```

Verify all 11 feature commits are present.
