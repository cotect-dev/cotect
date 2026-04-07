import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
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

type GitError = 'GIT_NOT_FOUND' | 'NOT_A_REPO' | 'NO_COMMITS' | 'PARTIAL_FAILURE' | null

interface GitState {
  repoPath: string
  initialized: boolean
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

export const useGitStore = createStoreWithHMR(import.meta.hot, 'git', () => create<GitState>((set, get) => ({
  repoPath: '',
  initialized: false,
  isGitRepo: false,
  gitError: null,
  status: null,
  log: null,
  branch: null,
  lastCommitTimestamp: null,
  loading: false,

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

      if (status.status === 'rejected') {
        const err = String(status.reason)
        if (err.includes('GIT_NOT_FOUND')) {
          const state = { initialized: true, isGitRepo: false, gitError: 'GIT_NOT_FOUND' as GitError, status: null, log: null, branch: null, lastCommitTimestamp: null }
          set({ ...state, loading: false })
          broadcastGitState(state)
          return
        }
        if (err.includes('NOT_A_REPO')) {
          const state = { initialized: true, isGitRepo: false, gitError: 'NOT_A_REPO' as GitError, status: null, log: null, branch: null, lastCommitTimestamp: null }
          set({ ...state, loading: false })
          broadcastGitState(state)
          return
        }
        // Unknown error from git_status — don't fall through to success path
        console.error('Git status failed with unknown error:', err)
        set({ initialized: true, isGitRepo: false, gitError: null, status: null, log: null, branch: null, lastCommitTimestamp: null, loading: false })
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
      set({ ...newState, loading: false })
      broadcastGitState(newState)
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
}

function broadcastGitState(state: Omit<GitSyncPayload, 'source'>): void {
  emit('git-sync', { ...state, source: windowId } as GitSyncPayload).catch(() => {})
}

let watcherCleanup: (() => void) | null = null

export function startGitWatcher(repoPath: string, currentWindowId: string): void {
  windowId = currentWindowId
  stopGitWatcher()

  const isMain = currentWindowId === 'main'
  const cleanups: (() => void)[] = []

  // All windows listen for cross-window sync
  let unlistenSync: UnlistenFn | null = null
  listen('git-sync', (event) => {
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
      })
    }
  }).then((fn) => { unlistenSync = fn })
  cleanups.push(() => { unlistenSync?.() })

  // Only main window runs git commands and broadcasts
  if (isMain) {
    // Watch .git/ for commits, branch switches, staging
    invoke('watch_path', { path: `${repoPath}/.git`, id: 'git', recursive: false }).catch(() => {})
    cleanups.push(() => { invoke('unwatch_path', { id: 'git' }).catch(() => {}) })

    // Watch source directories for working tree edits
    invoke('watch_path', { path: repoPath, id: 'source', recursive: false }).catch(() => {})
    cleanups.push(() => { invoke('unwatch_path', { id: 'source' }).catch(() => {}) })
    invoke('watch_path', { path: `${repoPath}/src`, id: 'source-src', recursive: true }).catch(() => {})
    cleanups.push(() => { invoke('unwatch_path', { id: 'source-src' }).catch(() => {}) })
    invoke('watch_path', { path: `${repoPath}/tauri/src`, id: 'source-rs', recursive: true }).catch(() => {})
    cleanups.push(() => { invoke('unwatch_path', { id: 'source-rs' }).catch(() => {}) })

    let unlisten: UnlistenFn | null = null
    listen('fs-changed', (event) => {
      const payload = event.payload as { id: string }
      if (payload.id === 'git' || payload.id === 'source' || payload.id === 'source-src' || payload.id === 'source-rs') {
        useGitStore.getState().refresh()
      }
    }).then((fn) => { unlisten = fn })
    cleanups.push(() => { unlisten?.() })

    const onFocus = () => { useGitStore.getState().refresh() }
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
