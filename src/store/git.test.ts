import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { useGitStore, sortedFiles, branchLabel, startGitWatcher, stopGitWatcher, buildGitSyncPayload, applyGitSyncPayload, type GitStatus, type GitLogEntry, type GitBranch, type GitSyncPayload } from './git'

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
    const mockBranch: GitBranch = { kind: 'branch', name: 'main' }
    const mockBranches: string[] = ['main', 'feat/x']
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
        .mockResolvedValueOnce(mockBranches)
        .mockResolvedValueOnce(mockTimestamp)

      await useGitStore.getState().refresh()

      const s = useGitStore.getState()
      expect(s.initialized).toBe(true)
      expect(s.isGitRepo).toBe(true)
      expect(s.gitError).toBeNull()
      expect(s.status).toEqual(mockStatus)
      expect(s.log).toEqual(mockLog)
      expect(s.branch).toEqual(mockBranch)
      expect(s.branches).toEqual(mockBranches)
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
      expect(mockInvoke).toHaveBeenCalledWith('git_branches', { repoPath: '/my/project' })
      expect(mockInvoke).toHaveBeenCalledWith('git_last_commit_time', { repoPath: '/my/project' })
    })

    it('broadcasts state via emit after successful refresh', async () => {
      useGitStore.setState({ repoPath: '/repo' })
      mockInvoke
        .mockResolvedValueOnce(mockStatus)
        .mockResolvedValueOnce(mockLog)
        .mockResolvedValueOnce(mockBranch)
        .mockResolvedValueOnce(mockBranches)
        .mockResolvedValueOnce(mockTimestamp)

      await useGitStore.getState().refresh()

      expect(mockEmit).toHaveBeenCalledWith('git-sync', expect.objectContaining({
        initialized: true,
        isGitRepo: true,
        gitError: null,
        status: mockStatus,
        log: mockLog,
        branch: mockBranch,
        branches: mockBranches,
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

    it('broadcasts git-sync exactly once per refresh when there are changed files', async () => {
      useGitStore.setState({ repoPath: '/repo' })
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'git_status') return Promise.resolve(mockStatus)
        if (cmd === 'git_log') return Promise.resolve(mockLog)
        if (cmd === 'git_branch') return Promise.resolve(mockBranch)
        if (cmd === 'git_branches') return Promise.resolve(mockBranches)
        if (cmd === 'git_last_commit_time') return Promise.resolve(mockTimestamp)
        if (cmd === 'git_file_times') return Promise.resolve([['a.ts', 5555]])
        return Promise.resolve(null)
      })

      await useGitStore.getState().refresh()
      // Wait a tick for the deferred fileTimes computation to settle.
      await new Promise((r) => setTimeout(r, 0))

      const syncEmits = mockEmit.mock.calls.filter(([name]) => name === 'git-sync')
      expect(syncEmits).toHaveLength(1)
      expect(syncEmits[0][1]).toMatchObject({
        isGitRepo: true,
        status: mockStatus,
        fileTimes: { 'a.ts': 5555 },
      })
    })

    it('sets PARTIAL_FAILURE when some commands fail (log fails, others succeed)', async () => {
      useGitStore.setState({ repoPath: '/repo' })
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'git_status') return Promise.resolve(mockStatus)
        if (cmd === 'git_log') return Promise.reject(new Error('log failed'))
        if (cmd === 'git_branch') return Promise.resolve(mockBranch)
        if (cmd === 'git_branches') return Promise.resolve(mockBranches)
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
    expect(mockInvoke).toHaveBeenCalledWith('watch_path', { path: '/repo/tauri/src', id: 'source-rs', recursive: true })
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

describe('sortedFiles selector', () => {
  beforeEach(() => {
    useGitStore.setState({
      status: {
        files: [
          { path: 'src/a.ts', status: 'M', insertions: 1, deletions: 0 },
          { path: 'src/b.ts', status: 'M', insertions: 2, deletions: 0 },
          { path: 'README.md', status: 'M', insertions: 3, deletions: 0 },
        ],
        total_insertions: 6,
        total_deletions: 0,
      },
      fileTimes: {
        'src/a.ts': 1000,
        'src/b.ts': 3000,
        'README.md': 2000,
      },
      sortMode: 'path',
    })
  })

  it('path mode returns the original order (tree building happens in the view)', () => {
    const files = sortedFiles(useGitStore.getState())
    expect(files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts', 'README.md'])
  })

  it('recent mode returns files sorted by descending timestamp', () => {
    useGitStore.setState({ sortMode: 'recent' })
    const files = sortedFiles(useGitStore.getState())
    expect(files.map((f) => f.path)).toEqual(['src/b.ts', 'README.md', 'src/a.ts'])
  })

  it('oldest mode returns files sorted by ascending timestamp', () => {
    useGitStore.setState({ sortMode: 'oldest' })
    const files = sortedFiles(useGitStore.getState())
    expect(files.map((f) => f.path)).toEqual(['src/a.ts', 'README.md', 'src/b.ts'])
  })

  it('recent mode places files with missing timestamps at the bottom', () => {
    useGitStore.setState({
      sortMode: 'recent',
      fileTimes: { 'src/b.ts': 3000 },
    })
    const files = sortedFiles(useGitStore.getState())
    expect(files[0].path).toBe('src/b.ts')
    expect(files.slice(1).map((f) => f.path)).toEqual(['src/a.ts', 'README.md'])
  })
})

describe('buildGitSyncPayload / applyGitSyncPayload', () => {
  const sliceStatus: GitStatus = { files: [{ path: 'a.ts', status: 'M', insertions: 1, deletions: 0 }], total_insertions: 1, total_deletions: 0 }
  const sliceLog: GitLogEntry[] = [{ hash: 'deadbee', message: 'msg', author: 'me', timestamp: 42, insertions: 0, deletions: 0, files: [] }]
  const sliceBranch: GitBranch = { kind: 'branch', name: 'main' }
  const slice = {
    initialized: true,
    isGitRepo: true,
    gitError: null,
    status: sliceStatus,
    log: sliceLog,
    branch: sliceBranch,
    branches: ['main', 'feat/x'],
    lastCommitTimestamp: 1234,
    headContent: { sha: 'abc', files: { 'a.ts': 'old' } },
    fileTimes: { 'a.ts': 999 },
    sortMode: 'recent' as const,
  }

  it('buildGitSyncPayload returns every sync field and excludes source', () => {
    const payload = buildGitSyncPayload(slice)
    expect(payload).toEqual(slice)
    expect(payload).not.toHaveProperty('source')
  })

  it('applyGitSyncPayload returns the GitState slice and drops source', () => {
    const payload: GitSyncPayload = { ...slice, source: 'main' }
    const out = applyGitSyncPayload(payload)
    expect(out).toEqual(slice)
    expect(out).not.toHaveProperty('source')
  })

  it('round-trips: build then apply yields the original slice', () => {
    const built = buildGitSyncPayload(slice)
    const onWire: GitSyncPayload = { ...built, source: 'main' }
    const applied = applyGitSyncPayload(onWire)
    expect(applied).toEqual(slice)
  })

  it('applying through setState reproduces the slice on the store', () => {
    resetStore()
    const payload: GitSyncPayload = { ...slice, source: 'other-window' }
    useGitStore.setState(applyGitSyncPayload(payload))
    const s = useGitStore.getState()
    expect(s.initialized).toBe(slice.initialized)
    expect(s.isGitRepo).toBe(slice.isGitRepo)
    expect(s.gitError).toBe(slice.gitError)
    expect(s.status).toEqual(slice.status)
    expect(s.log).toEqual(slice.log)
    expect(s.branch).toEqual(slice.branch)
    expect(s.branches).toEqual(slice.branches)
    expect(s.lastCommitTimestamp).toBe(slice.lastCommitTimestamp)
    expect(s.headContent).toEqual(slice.headContent)
    expect(s.fileTimes).toEqual(slice.fileTimes)
    expect(s.sortMode).toBe(slice.sortMode)
  })
})

describe('branchLabel', () => {
  it('returns the branch name for a named branch', () => {
    expect(branchLabel({ kind: 'branch', name: 'main' })).toBe('main')
    expect(branchLabel({ kind: 'branch', name: 'feature/x' })).toBe('feature/x')
  })

  it('returns "detached @ <sha>" for a detached HEAD', () => {
    expect(branchLabel({ kind: 'detached', short_sha: 'abc1234' })).toBe('detached @ abc1234')
  })

  it('returns "(no commits yet)" for an initial repo', () => {
    expect(branchLabel({ kind: 'initial' })).toBe('(no commits yet)')
  })

  it('returns "unknown" when branch is null', () => {
    expect(branchLabel(null)).toBe('unknown')
  })
})
