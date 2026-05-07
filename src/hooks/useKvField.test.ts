import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useKvField } from './useKvField'

vi.mock('@/services/db', () => ({
  kvGet: vi.fn(),
  kvSet: vi.fn(),
}))

import { kvGet, kvSet } from '@/services/db'

describe('useKvField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('returns default until kv_get resolves', async () => {
    vi.mocked(kvGet).mockResolvedValue(null)
    const { result } = renderHook(() => useKvField<number>('agent.max_turns', 25))
    expect(result.current[0]).toBe(25)
  })

  it('hydrates from kv_get', async () => {
    vi.mocked(kvGet).mockResolvedValue(42)
    const { result } = renderHook(() => useKvField<number>('agent.max_turns', 25))
    await waitFor(() => expect(result.current[0]).toBe(42))
  })

  it('debounces writes to kv_set', async () => {
    vi.useFakeTimers()
    vi.mocked(kvGet).mockResolvedValue(null)
    vi.mocked(kvSet).mockResolvedValue(undefined)
    const { result } = renderHook(() => useKvField<number>('k', 0, 500))
    act(() => { result.current[1](1) })
    act(() => { result.current[1](2) })
    expect(kvSet).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(500) })
    vi.useRealTimers()
    await waitFor(() => expect(kvSet).toHaveBeenCalledTimes(1))
    expect(kvSet).toHaveBeenCalledWith('k', 2)
  })
})
