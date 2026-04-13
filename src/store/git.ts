import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { createStoreWithHMR } from '@/lib/hmr'

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

type GitError = 'GIT_NOT_FOUND' | 'NOT_A_REPO' | 'NO_COMMITS' | 'GIT_TIMEOUT' | 'PARTIAL_FAILURE' | null

interface GitState {
  repoPath: string
  initialized: boolean
  isGitRepo: boolean
  gitError: GitError
  status: GitStatus | null
  log: GitLogEntry[] | null
  branch: GitBranch | null
  lastCommitTimestamp: number | null
  /**
   * Map of repo-relative path → HEAD content for that file.
   * Lazily populated by loadHeadContent. Invalidated (replaced with empty) when
   * HEAD SHA changes.
   */
  headContent: { sha: string; files: Record<string, string> }
  loadHeadContent: (repoRelativePath: string) => Promise<string | null>
  /** Hybrid timestamps (unix seconds) per repo-relative dirty file path. */
  fileTimes: Record<string, number>
  /** Current Changes-panel sort mode. Not persisted across restarts. */
  sortMode: 'path' | 'recent' | 'oldest'
  setSortMode: (mode: 'path' | 'recent' | 'oldest') => void
  loading: boolean
  refresh: () => Promise<void>
  initRepo: () => Promise<void>
  setRepoPath: (path: string) => void
}

const failedGitState = (gitError: GitError): Pick<GitState, 'initialized' | 'isGitRepo' | 'gitError' | 'status' | 'log' | 'branch' | 'lastCommitTimestamp'> => ({
  initialized: true,
  isGitRepo: false,
  gitError,
  status: null,
  log: null,
  branch: null,
  lastCommitTimestamp: null,
})

export const useGitStore = createStoreWithHMR(import.meta.hot, 'git', () => create<GitState>((set, get) => ({
  repoPath: '',
  initialized: false,
  isGitRepo: false,
  gitError: null,
  status: null,
  log: null,
  branch: null,
  lastCommitTimestamp: null,
  headContent: { sha: '', files: {} },
  fileTimes: {},
  sortMode: 'path',
  loading: false,

  setSortMode: (mode) => {
    set({ sortMode: mode })
  },

  loadHeadContent: async (repoRelativePath: string) => {
    const { repoPath, headContent } = get()
    if (!repoPath) return null
    if (headContent.files[repoRelativePath] !== undefined) {
      return headContent.files[repoRelativePath]
    }
    try {
      const content = await invoke<string>('git_show_file', {
        repoPath,
        filePath: repoRelativePath,
      })
      set((state) => ({
        headContent: {
          sha: state.headContent.sha,
          files: { ...state.headContent.files, [repoRelativePath]: content },
        },
      }))
      return content
    } catch {
      return null
    }
  },

  refresh: async () => {
    const { repoPath, loading } = get()
    if (!repoPath || loading) return

    set({ loading: true })

    try {
      const [status, log, branch, lastCommitTime] = await Promise.allSettled([
        invoke<GitStatus>('git_status', { repoPath }),
        invoke<GitLogEntry[]>('git_log', { repoPath, limit: 50 }),
        invoke<GitBranch>('git_branch', { repoPath }),
        invoke<number>('git_last_commit_time', { repoPath }),
      ])

      const broadcastFailed = (state: ReturnType<typeof failedGitState>) => {
        broadcastGitState({
          ...state,
          headContent: { sha: '', files: {} },
          fileTimes: {},
          sortMode: get().sortMode,
        })
      }

      if (status.status === 'rejected') {
        const err = String(status.reason)
        if (err.includes('GIT_NOT_FOUND')) {
          const state = failedGitState('GIT_NOT_FOUND')
          set({ ...state, loading: false })
          broadcastFailed(state)
          return
        }
        if (err.includes('NOT_A_REPO')) {
          const state = failedGitState('NOT_A_REPO')
          set({ ...state, loading: false })
          broadcastFailed(state)
          return
        }
        if (err.includes('GIT_TIMEOUT')) {
          const state = failedGitState('GIT_TIMEOUT')
          set({ ...state, loading: false })
          broadcastFailed(state)
          return
        }
        // Unknown error from git_status — don't fall through to success path
        console.error('Git status failed with unknown error:', err)
        set({ ...failedGitState(null), loading: false })
        return
      }

      const hasPartialFailure = [status, log, branch, lastCommitTime].some(
        (r) => r.status === 'rejected',
      )

      const newState = {
        initialized: true,
        isGitRepo: true,
        gitError: hasPartialFailure ? ('PARTIAL_FAILURE' as GitError) : (null as GitError),
        status: status.status === 'fulfilled' ? status.value : null,
        log: log.status === 'fulfilled' ? log.value : null,
        branch: branch.status === 'fulfilled' ? branch.value : null,
        lastCommitTimestamp: lastCommitTime.status === 'fulfilled' ? lastCommitTime.value : null,
      }
      const headSha = log.status === 'fulfilled' && log.value[0] ? log.value[0].hash : ''
      const currentHeadContent = get().headContent
      const nextHeadContent =
        currentHeadContent.sha === headSha
          ? currentHeadContent
          : { sha: headSha, files: {} }
      set({ ...newState, headContent: nextHeadContent, loading: false })
      broadcastGitState({
        ...newState,
        headContent: nextHeadContent,
        fileTimes: get().fileTimes,
        sortMode: get().sortMode,
      })

      // Recompute per-file timestamps in the background. Fire-and-forget — the
      // UI already renders with the old fileTimes while this runs.
      if (newState.status && newState.status.files.length > 0) {
        const paths = newState.status.files.map((f) => f.path)
        const statusFiles = newState.status.files
        invoke<Array<[string, number | null]>>('git_file_times', { repoPath, paths })
          .then(async (result) => {
            const { stat } = await import('@tauri-apps/plugin-fs')
            const headTimes: Record<string, number> = {}
            for (const [p, ts] of result) {
              if (ts !== null) headTimes[p] = ts
            }
            const hybrid: Record<string, number> = {}
            await Promise.all(
              statusFiles.map(async (f) => {
                let fsTime: number | null = null
                try {
                  const s = await stat(`${repoPath}/${f.path}`)
                  const mtime = s.mtime ? s.mtime.getTime() : 0
                  if (!Number.isNaN(mtime) && mtime > 0) fsTime = Math.floor(mtime / 1000)
                } catch {
                  // file doesn't exist on disk (deleted) — fall back to head time only
                }
                const headTime = headTimes[f.path] ?? null
                if (f.status === 'A' || f.status === 'U') {
                  if (fsTime !== null) hybrid[f.path] = fsTime
                } else if (f.status === 'D') {
                  if (headTime !== null) hybrid[f.path] = headTime
                } else {
                  const best = Math.max(headTime ?? 0, fsTime ?? 0)
                  if (best > 0) hybrid[f.path] = best
                }
              }),
            )
            set({ fileTimes: hybrid })
            broadcastGitState({
              ...newState,
              headContent: nextHeadContent,
              fileTimes: hybrid,
              sortMode: get().sortMode,
            })
          })
          .catch((err) => {
            console.warn('[git] fileTimes refresh failed:', err)
          })
      } else {
        set({ fileTimes: {} })
      }
    } catch (err) {
      console.error('Git refresh failed:', err)
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
    if (path === get().repoPath) return
    set({ repoPath: path, initialized: false, isGitRepo: false, gitError: null, status: null, log: null, branch: null, lastCommitTimestamp: null })
  },
})))

/**
 * Return the files in the order required by the current sort mode.
 * - 'path': original order (tree building happens in the view layer).
 * - 'recent': descending by fileTimes, files with missing timestamps last in original order.
 * - 'oldest': ascending by fileTimes, files with missing timestamps last in original order.
 */
export function sortedFiles(state: Pick<GitState, 'status' | 'fileTimes' | 'sortMode'>): GitFileStatus[] {
  const files = state.status?.files ?? []
  if (state.sortMode === 'path') return files

  const withTime = files.map((file, originalIndex) => ({
    file,
    time: state.fileTimes[file.path] ?? null,
    originalIndex,
  }))

  const cmp = (
    a: { time: number | null; originalIndex: number },
    b: { time: number | null; originalIndex: number },
  ) => {
    if (a.time === null && b.time === null) return a.originalIndex - b.originalIndex
    if (a.time === null) return 1
    if (b.time === null) return -1
    return state.sortMode === 'recent' ? b.time - a.time : a.time - b.time
  }

  return withTime.slice().sort(cmp).map((entry) => entry.file)
}

let windowId = ''

interface GitSyncPayload {
  source: string
  initialized: boolean
  isGitRepo: boolean
  gitError: GitError
  status: GitStatus | null
  log: GitLogEntry[] | null
  branch: GitBranch | null
  lastCommitTimestamp: number | null
  headContent: { sha: string; files: Record<string, string> }
  fileTimes: Record<string, number>
  sortMode: 'path' | 'recent' | 'oldest'
}

function broadcastGitState(state: Omit<GitSyncPayload, 'source'>): void {
  emit('git-sync', { ...state, source: windowId } as GitSyncPayload).catch((err) => {
    console.warn('[git] broadcast failed:', err)
  })
}

let watcherCleanup: (() => void) | null = null

export function startGitWatcher(repoPath: string, currentWindowId: string): void {
  windowId = currentWindowId
  stopGitWatcher()

  const isMain = currentWindowId === 'main'
  const cleanups: (() => void)[] = []

  // All windows listen for cross-window sync
  const syncListenPromise = listen('git-sync', (event) => {
    const payload = event.payload as GitSyncPayload
    if (payload.source !== currentWindowId) {
      useGitStore.setState({
        initialized: payload.initialized,
        isGitRepo: payload.isGitRepo,
        gitError: payload.gitError,
        status: payload.status,
        log: payload.log,
        branch: payload.branch,
        lastCommitTimestamp: payload.lastCommitTimestamp,
        headContent: payload.headContent,
        fileTimes: payload.fileTimes,
        sortMode: payload.sortMode,
      })
    }
  })
  cleanups.push(() => {
    syncListenPromise.then((fn) => fn()).catch((err) => {
      console.warn('[git] failed to detach sync listener:', err)
    })
  })

  // Only main window runs git commands and broadcasts
  if (isMain) {
    const watches: Array<{ path: string; id: string; recursive: boolean }> = [
      { path: `${repoPath}/.git`, id: 'git', recursive: false },
      { path: repoPath, id: 'source', recursive: false },
      { path: `${repoPath}/src`, id: 'source-src', recursive: true },
      { path: `${repoPath}/tauri/src`, id: 'source-rs', recursive: true },
    ]
    for (const w of watches) {
      invoke('watch_path', w).catch((err) => {
        console.warn(`[git] watch_path "${w.id}" failed — git state may become stale:`, err)
      })
      cleanups.push(() => {
        invoke('unwatch_path', { id: w.id }).catch((err) => {
          console.warn(`[git] unwatch_path "${w.id}" failed:`, err)
        })
      })
    }

    const GIT_WATCH_IDS = new Set(watches.map((w) => w.id))
    const fsListenPromise = listen('fs-changed', (event) => {
      const payload = event.payload as { id: string }
      if (GIT_WATCH_IDS.has(payload.id)) {
        useGitStore.getState().refresh().catch((err) => {
          console.warn('[git] refresh after fs change failed:', err)
        })
      }
    })
    cleanups.push(() => {
      fsListenPromise.then((fn) => fn()).catch((err) => {
        console.warn('[git] failed to detach fs-changed listener:', err)
      })
    })

    const onFocus = () => {
      useGitStore.getState().refresh().catch((err) => {
        console.warn('[git] refresh on window focus failed:', err)
      })
    }
    window.addEventListener('focus', onFocus)
    cleanups.push(() => window.removeEventListener('focus', onFocus))
  }

  watcherCleanup = () => {
    for (const fn of cleanups) fn()
  }
}

export function stopGitWatcher(): void {
  watcherCleanup?.()
  watcherCleanup = null
}
