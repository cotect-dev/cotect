import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { formatDuration, formatRelativeTime } from './time'

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

describe('formatDuration', () => {
  it('returns 0s for zero ms', () => {
    expect(formatDuration(0)).toBe('0s')
  })

  it('rounds down to whole seconds below 60s', () => {
    expect(formatDuration(1_500)).toBe('1s')
    expect(formatDuration(59_999)).toBe('59s')
  })

  it('switches to m+s format at 60s', () => {
    expect(formatDuration(60_000)).toBe('1m 0s')
    expect(formatDuration(90_000)).toBe('1m 30s')
  })

  it('handles many minutes', () => {
    expect(formatDuration(125_000)).toBe('2m 5s')
    expect(formatDuration(3_600_000)).toBe('60m 0s')
  })
})
