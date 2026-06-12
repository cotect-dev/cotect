import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  check: vi.fn(),
  ask: vi.fn(),
  message: vi.fn(),
  relaunch: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: mocks.check }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: mocks.ask, message: mocks.message }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: mocks.relaunch }))

import { checkForUpdates } from './updater'

function fakeUpdate(version = '0.3.0') {
  return {
    version,
    currentVersion: '0.2.0',
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  }
}

// The vitest jsdom localStorage is a bare object without Storage methods;
// stub a minimal working one so the once-per-version memory is testable.
function inMemoryStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('localStorage', inMemoryStorage())
})

describe('checkForUpdates', () => {
  it('does nothing when no update is available', async () => {
    mocks.invoke.mockResolvedValue(true)
    mocks.check.mockResolvedValue(null)
    await checkForUpdates()
    expect(mocks.ask).not.toHaveBeenCalled()
    expect(mocks.message).not.toHaveBeenCalled()
  })

  it('installs and relaunches when self-updatable and accepted', async () => {
    mocks.invoke.mockResolvedValue(true)
    const update = fakeUpdate()
    mocks.check.mockResolvedValue(update)
    mocks.ask.mockResolvedValue(true)
    await checkForUpdates()
    expect(update.downloadAndInstall).toHaveBeenCalled()
    expect(mocks.relaunch).toHaveBeenCalled()
  })

  it('announces through the package manager when not self-updatable', async () => {
    mocks.invoke.mockResolvedValue(false)
    const update = fakeUpdate()
    mocks.check.mockResolvedValue(update)
    await checkForUpdates()
    expect(mocks.message).toHaveBeenCalledOnce()
    expect(String(mocks.message.mock.calls[0][0])).toContain('package manager')
    expect(update.downloadAndInstall).not.toHaveBeenCalled()
    expect(mocks.ask).not.toHaveBeenCalled()
  })

  it('announces each version only once', async () => {
    mocks.invoke.mockResolvedValue(false)
    mocks.check.mockResolvedValue(fakeUpdate('0.3.0'))
    await checkForUpdates()
    await checkForUpdates()
    expect(mocks.message).toHaveBeenCalledOnce()
    mocks.check.mockResolvedValue(fakeUpdate('0.4.0'))
    await checkForUpdates()
    expect(mocks.message).toHaveBeenCalledTimes(2)
  })
})
