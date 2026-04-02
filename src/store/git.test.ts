import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { useGitStore, startGitWatcher, stopGitWatcher, type GitStatus, type GitLogEntry, type GitBranch } from './git'

// Tauri APIs are auto-mocked via setup.ts. Cast for type-safe assertions.
const mockInvoke = invoke as Mock
const mockEmit = (emit as Mock).mockReturnValue(Promise.resolve())
const mockListen = listen as Mock

function resetStore() {
  useGitStore.setState({
    repoPath: '',
    initialized: false,
    isGitRepo: false,
    gitError: null,
    status: null,
    log: null,
    branch: null,
    lastCommitTimestamp: null,
    loading: false,
  })
}

describe('useGitStore', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('starts with empty repoPath', () => {
      expect(useGitStore.getState().repoPath).toBe('')
    })

    it('starts uninitialized', () => {
      expect(useGitStore.getState().initialized).toBe(false)
    })

    it('starts with isGitRepo false', () => {
      expect(useGitStore.getState().isGitRepo).toBe(false)
    })

    it('starts with null gitError', () => {
      expect(useGitStore.getState().gitError).toBeNull()
    })

    it('starts with null status, log, branch, lastCommitTimestamp', () => {
      const s = useGitStore.getState()
      expect(s.status).toBeNull()
      expect(s.log).toBeNull()
      expect(s.branch).toBeNull()
      expect(s.lastCommitTimestamp).toBeNull()
    })

    it('starts with loading false', () => {
      expect(useGitStore.getState().loading).toBe(false)
    })
  })

  describe('setRepoPath', () => {
    it('sets the repoPath and resets state', () => {
      useGitStore.setState({ initialized: true, isGitRepo: true })
      useGitStore.getState().setRepoPath('/new/path')

      const s = useGitStore.getState()
      expect(s.repoPath).toBe('/new/path')
      expect(s.initialized).toBe(false)
      expect(s.isGitRepo).toBe(false)
      expect(s.gitError).toBeNull()
      expect(s.status).toBeNull()
      expect(s.log).toBeNull()
      expect(s.branch).toBeNull()
      expect(s.lastCommitTimestamp).toBeNull()
    })

    it('no-ops when path is the same', () => {
      useGitStore.setState({ repoPath: '/same', initialized: true })
      useGitStore.getState().setRepoPath('/same')
      expect(useGitStore.getState().initialized).toBe(true)
    })
  })

  describe('refresh', () => {
    const mockStatus: GitStatus = { files: [{ path: 'a.ts', status: 'M', insertions: 5, deletions: 2 }], total_insertions: 5, total_deletions: 2 }
    const mockLog: GitLogEntry[] = [{ hash: 'abc1234', message: 'init', author: 'dev', timestamp: 1000, insertions: 10, deletions: 0, files: [] }]
    const mockBranch: GitBranch = { current: 'main' }
    const mockTimestamp = 1234567890

    it('does nothing when repoPath is empty', async () => {
      await useGitStore.getState().refresh()
      expect(mockInvoke).not.toHaveBeenCalled()
      expect(useGitStore.getState().loading).toBe(false)
    })

    it('does nothing when already loading', async () => {
      useGitStore.setState({ repoPath: '/repo', loading: true })
      await useGitStore.getState().refresh()
      expect(mockInvoke).not.toHaveBeenCalled()
    })

    it('sets loading during refresh', async () => {
      useGitStore.setState({ repoPath: '/repo' })
      mockInvoke.mockResolvedValue(null)

      const promise = useGitStore.getState().refresh()
      // loading is set synchronously before awaits
      expect(useGitStore.getState().loading).toBe(true)
      await promise
      expect(useGitStore.getState().loading).toBe(false)
    })

    it('populates state on successful refresh', async () => {
      useGitStore.setState({ repoPath: '/repo' })
      mockInvoke
        .mockResolvedValueOnce(mockStatus)
        .mockResolvedValueOnce(mockLog)
        .mockResolvedValueOnce(mockBranch)
        .mockResolvedValueOnce(mockTimestamp)

      await useGitStore.getState().refresh()

      const s = useGitStore.getState()
      expect(s.initialized).toBe(true)
      expect(s.isGitRepo).toBe(true)
      expect(s.gitError).toBeNull()
      expect(s.status).toEqual(mockStatus)
      expect(s.log).toEqual(mockLog)
      expect(s.branch).toEqual(mockBranch)
      expect(s.lastCommitTimestamp).toBe(mockTimestamp)
      expect(s.loading).toBe(false)
    })

    it('invokes correct commands with repoPath', async () => {
      useGitStore.setState({ repoPath: '/my/project' })
      mockInvoke.mockResolvedValue(null)

      await useGitStore.getState().refresh()

      expect(mockInvoke).toHaveBeenCalledWith('git_status', { repoPath: '/my/project' })
      expect(mockInvoke).toHaveBeenCalledWith('git_log', { repoPath: '/my/project', limit: 50 })
      expect(mockInvoke).toHaveBeenCalledWith('git_branch', { repoPath: '/my/project' })
      expect(mockInvoke).toHaveBeenCalledWith('git_last_commit_time', { repoPath: '/my/project' })
    })

    it('broadcasts state via emit after successful refresh', async () => {
      useGitStore.setState({ repoPath: '/repo' })
      mockInvoke
        .mockResolvedValueOnce(mockStatus)
        .mockResolvedValueOnce(mockLog)
        .mockResolvedValueOnce(mockBranch)
        .mockResolvedValueOnce(mockTimestamp)

      await useGitStore.getState().refresh()

      expect(mockEmit).toHaveBeenCalledWith('git-sync', expect.objectContaining({
        initialized: true,
        isGitRepo: true,
        gitError: null,
        status: mockStatus,
        log: mockLog,
        branch: mockBranch,
        lastCommitTimestamp: mockTimestamp,
      }))
    })

    it('handles GIT_NOT_FOUND error', async () => {
      useGitStore.setState({ repoPath: '/repo' })
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'git_status') return Promise.reject(new Error('GIT_NOT_FOUND: git is not installed'))
        return Promise.resolve(null)
      })

      await useGitStore.getState().refresh()

      const s = useGitStore.getState()
      expect(s.initialized).toBe(true)
      expect(s.isGitRepo).toBe(false)
      expect(s.gitError).toBe('GIT_NOT_FOUND')
      expect(s.loading).toBe(false)
    })

    it('handles NOT_A_REPO error', async () => {
      useGitStore.setState({ repoPath: '/repo' })
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'git_status') return Promise.reject(new Error('NOT_A_REPO: not a git repository'))
        return Promise.resolve(null)
      })

      await useGitStore.getState().refresh()

      const s = useGitStore.getState()
      expect(s.initialized).toBe(true)
      expect(s.isGitRepo).toBe(false)
      expect(s.gitError).toBe('NOT_A_REPO')
      expect(s.loading).toBe(false)
    })

    it('broadcasts error state on GIT_NOT_FOUND', async () => {
      useGitStore.setState({ repoPath: '/repo' })
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'git_status') return Promise.reject(new Error('GIT_NOT_FOUND'))
        return Promise.resolve(null)
      })

      await useGitStore.getState().refresh()

      expect(mockEmit).toHaveBeenCalledWith('git-sync', expect.objectContaining({
        isGitRepo: false,
        gitError: 'GIT_NOT_FOUND',
      }))
    })

    it('handles unknown git_status error without treating it as success', async () => {
      useGitStore.setState({ repoPath: '/repo' })
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'git_status') return Promise.reject(new Error('Permission denied'))
        return Promise.resolve(null)
      })

      await useGitStore.getState().refresh()

      const s = useGitStore.getState()
      expect(s.initialized).toBe(true)
      expect(s.isGitRepo).toBe(false) // NOT treated as success
      expect(s.loading).toBe(false)
    })

    it('sets PARTIAL_FAILURE when some commands fail (log fails, others succeed)', async () => {
      useGitStore.setState({ repoPath: '/repo' })
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'git_status') return Promise.resolve(mockStatus)
        if (cmd === 'git_log') return Promise.reject(new Error('log failed'))
        if (cmd === 'git_branch') return Promise.resolve(mockBranch)
        if (cmd === 'git_last_commit_time') return Promise.resolve(mockTimestamp)
        return Promise.resolve(null)
      })

      await useGitStore.getState().refresh()

      const s = useGitStore.getState()
      expect(s.initialized).toBe(true)
      expect(s.isGitRepo).toBe(true)
      expect(s.gitError).toBe('PARTIAL_FAILURE')
      expect(s.status).toEqual(mockStatus)
      expect(s.log).toBeNull()  // failed
      expect(s.branch).toEqual(mockBranch)
      expect(s.lastCommitTimestamp).toBe(mockTimestamp)
    })
  })

  describe('initRepo', () => {
    it('does nothing when repoPath is empty', async () => {
      await useGitStore.getState().initRepo()
      expect(mockInvoke).not.toHaveBeenCalledWith('git_init', expect.anything())
    })

    it('invokes git_init and then refreshes', async () => {
      useGitStore.setState({ repoPath: '/repo' })
      mockInvoke.mockResolvedValue(null)

      await useGitStore.getState().initRepo()

      expect(mockInvoke).toHaveBeenCalledWith('git_init', { repoPath: '/repo' })
      // refresh calls 4 more invokes
      expect(mockInvoke).toHaveBeenCalledWith('git_status', { repoPath: '/repo' })
    })
  })
})

describe('startGitWatcher / stopGitWatcher', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
    stopGitWatcher()
    // Default: listen resolves with a cleanup fn
    mockListen.mockResolvedValue(vi.fn())
  })

  it('sets up watchers for main window', () => {
    mockInvoke.mockResolvedValue(undefined)
    startGitWatcher('/repo', 'main')

    // listen for git-sync (all windows) + fs-changed (main only)
    expect(mockListen).toHaveBeenCalledWith('git-sync', expect.any(Function))
    expect(mockListen).toHaveBeenCalledWith('fs-changed', expect.any(Function))

    // watch_path calls for main window
    expect(mockInvoke).toHaveBeenCalledWith('watch_path', { path: '/repo/.git', id: 'git', recursive: false })
    expect(mockInvoke).toHaveBeenCalledWith('watch_path', { path: '/repo', id: 'source', recursive: false })
    expect(mockInvoke).toHaveBeenCalledWith('watch_path', { path: '/repo/src', id: 'source-src', recursive: true })
    expect(mockInvoke).toHaveBeenCalledWith('watch_path', { path: '/repo/src-tauri/src', id: 'source-rs', recursive: true })
  })

  it('does not set up file watchers for non-main window', () => {
    mockInvoke.mockResolvedValue(undefined)
    startGitWatcher('/repo', 'child-1')

    // listen for git-sync only
    expect(mockListen).toHaveBeenCalledWith('git-sync', expect.any(Function))
    expect(mockListen).not.toHaveBeenCalledWith('fs-changed', expect.any(Function))
    expect(mockInvoke).not.toHaveBeenCalledWith('watch_path', expect.anything())
  })

  it('stopGitWatcher can be called safely when no watcher is running', () => {
    expect(() => stopGitWatcher()).not.toThrow()
  })
})
