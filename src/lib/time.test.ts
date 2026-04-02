import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { formatRelativeTime } from './time'

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows seconds for < 60s', () => {
    const now = Date.now() / 1000
    vi.setSystemTime(Date.now())
    expect(formatRelativeTime(now - 30)).toBe('30s ago')
  })

  it('shows 0s for current time', () => {
    const now = Date.now() / 1000
    vi.setSystemTime(Date.now())
    expect(formatRelativeTime(now)).toBe('0s ago')
  })

  it('shows minutes for 60s-3600s', () => {
    const now = Date.now() / 1000
    vi.setSystemTime(Date.now())
    expect(formatRelativeTime(now - 120)).toBe('2m ago')
    expect(formatRelativeTime(now - 3599)).toBe('59m ago')
  })

  it('shows hours for 3600s-86400s', () => {
    const now = Date.now() / 1000
    vi.setSystemTime(Date.now())
    expect(formatRelativeTime(now - 7200)).toBe('2h ago')
    expect(formatRelativeTime(now - 86399)).toBe('23h ago')
  })

  it('shows days for >= 86400s', () => {
    const now = Date.now() / 1000
    vi.setSystemTime(Date.now())
    expect(formatRelativeTime(now - 86400)).toBe('1d ago')
    expect(formatRelativeTime(now - 172800)).toBe('2d ago')
  })
})
