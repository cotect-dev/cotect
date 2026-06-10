import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { markSelfWrite, onExternalFileChange, emitFileChanges, _testReset } from './fileChanges'

beforeEach(() => {
  _testReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('fileChanges bus', () => {
  it('notifies subscribers of their path only', () => {
    const a = vi.fn()
    const b = vi.fn()
    onExternalFileChange('/repo/a.ts', a)
    onExternalFileChange('/repo/b.ts', b)
    emitFileChanges(['/repo/a.ts', '/repo/c.ts'])
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
  })

  it('unsubscribe stops notifications', () => {
    const fn = vi.fn()
    const off = onExternalFileChange('/repo/a.ts', fn)
    off()
    emitFileChanges(['/repo/a.ts'])
    expect(fn).not.toHaveBeenCalled()
  })

  it('suppresses watcher echoes of our own writes within the window', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    onExternalFileChange('/repo/a.ts', fn)

    markSelfWrite('/repo/a.ts')
    vi.advanceTimersByTime(500)
    emitFileChanges(['/repo/a.ts'])
    expect(fn).not.toHaveBeenCalled()

    // After the window, changes to the same path are external again.
    vi.advanceTimersByTime(3000)
    emitFileChanges(['/repo/a.ts'])
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('self-write on one path does not mute others', () => {
    const fn = vi.fn()
    onExternalFileChange('/repo/b.ts', fn)
    markSelfWrite('/repo/a.ts')
    emitFileChanges(['/repo/a.ts', '/repo/b.ts'])
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
