import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'

// Make emit return a resolved Promise so broadcastGitState's .catch() works
;(emit as Mock).mockReturnValue(Promise.resolve())

// --- Mock platform with controllable windowId and session ---

let mockWindowId = 'main'
let mockSessionData: { rootPath: string } | null = null

vi.mock('@/services/platform', () => ({
  getPlatform: () => ({
    isWayland: vi.fn().mockResolvedValue(false),
    windows: {
      getWindowId: () => mockWindowId,
      setMinSize: vi.fn().mockResolvedValue(undefined),
      show: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      maximize: vi.fn().mockResolvedValue(undefined),
      isMaximized: vi.fn().mockResolvedValue(false),
      getPosition: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
      getSize: vi.fn().mockResolvedValue({ width: 1280, height: 720 }),
      move: vi.fn().mockResolvedValue(undefined),
      onMoved: vi.fn().mockResolvedValue(() => {}),
      onResized: vi.fn().mockResolvedValue(() => {}),
      onClose: vi.fn().mockReturnValue(() => {}),
      create: vi.fn().mockResolvedValue(undefined),
      getMonitors: vi.fn().mockResolvedValue([]),
      getWindowMonitor: vi.fn().mockResolvedValue(null),
      setWindowOnMonitor: vi.fn().mockResolvedValue(false),
      getCursorWindow: vi.fn().mockResolvedValue(null),
      closeAll: vi.fn().mockResolvedValue(undefined),
    },
    ipc: {
      emit: vi.fn().mockResolvedValue(undefined),
      listen: vi.fn().mockReturnValue(() => {}),
    },
    fs: {
      readFile: vi.fn().mockResolvedValue(''),
      writeFile: vi.fn().mockResolvedValue(undefined),
      readDirectory: vi.fn().mockResolvedValue([]),
      showFolderDialog: vi.fn().mockResolvedValue(null),
    },
    storage: {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'wm-session-main') return Promise.resolve(mockSessionData)
        return Promise.resolve(null)
      }),
      set: vi.fn().mockResolvedValue(undefined),
      setSync: vi.fn(),
      remove: vi.fn().mockResolvedValue(undefined),
      removeSync: vi.fn(),
      exists: vi.fn().mockResolvedValue(false),
      listKeys: vi.fn().mockResolvedValue([]),
    },
    syncedState: {
      set: vi.fn(),
      get: vi.fn().mockResolvedValue(null),
      clear: vi.fn().mockResolvedValue(undefined),
      listen: vi.fn().mockReturnValue(() => {}),
    },
  }),
}))

import { useWindowLifecycle } from './useWindowLifecycle'
import { useGitStore, stopGitWatcher } from '@/store/git'
import { useBrowserStore } from '@/store/browser'

const mockInvoke = invoke as Mock

describe('useWindowLifecycle — git initialization on session restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWindowId = 'main'
    mockSessionData = null

    // Reset stores
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
    useBrowserStore.setState({ rootPath: '' })
    stopGitWatcher()

    // Default: invoke returns null (used by git refresh)
    mockInvoke.mockResolvedValue(null)
  })

  it('initializes git store when session has a saved rootPath', async () => {
    mockSessionData = { rootPath: '/home/user/project' }

    const { result } = renderHook(() => useWindowLifecycle())

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    // Git store should have the repo path from the restored session
    const gitState = useGitStore.getState()
    expect(gitState.repoPath).toBe('/home/user/project')

    // refresh() should have been called (it invokes git_status etc.)
    expect(mockInvoke).toHaveBeenCalledWith('git_status', { repoPath: '/home/user/project' })
  })

  it('does NOT initialize git when there is no saved session', async () => {
    mockSessionData = null

    const { result } = renderHook(() => useWindowLifecycle())

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    expect(useGitStore.getState().repoPath).toBe('')
    expect(mockInvoke).not.toHaveBeenCalledWith('git_status', expect.anything())
  })

  it('initializes git for child windows with a saved session', async () => {
    mockWindowId = 'child-1'
    mockSessionData = { rootPath: '/home/user/project' }

    const { result } = renderHook(() => useWindowLifecycle())

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    const gitState = useGitStore.getState()
    expect(gitState.repoPath).toBe('/home/user/project')
    expect(mockInvoke).toHaveBeenCalledWith('git_status', { repoPath: '/home/user/project' })
  })
})
