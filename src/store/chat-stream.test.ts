import { describe, it, expect, vi } from 'vitest'

// Mock platform before importing the module that depends on it
vi.mock('@/services/platform', () => ({
  getPlatform: () => ({
    syncedState: {
      set: vi.fn(),
      get: vi.fn().mockResolvedValue(null),
      clear: vi.fn(),
      listen: vi.fn().mockReturnValue(() => {}),
    },
    windows: {
      getWindowId: () => 'test-window',
    },
  }),
}))

import { countWords, createAccumulator, processStreamChunk } from './chat'

describe('countWords', () => {
  it('counts words in a string', () => {
    expect(countWords('hello world')).toBe(2)
    expect(countWords('one')).toBe(1)
    expect(countWords('')).toBe(0)
    expect(countWords('  multiple   spaces  ')).toBe(2)
  })
})

describe('createAccumulator', () => {
  it('creates a clean accumulator', () => {
    const acc = createAccumulator()
    expect(acc.content).toBe('')
    expect(acc.thinking).toBe('')
    expect(acc.rawStream).toBe('')
    expect(acc.inThinkTag).toBe(false)
    expect(acc.totalTokens).toBe(0)
  })
})

describe('processStreamChunk', () => {
  it('accumulates plain text content', () => {
    const acc = createAccumulator()
    processStreamChunk(acc, 'Hello', '')
    processStreamChunk(acc, ' world', '')
    expect(acc.content).toBe('Hello world')
    expect(acc.thinking).toBe('')
    expect(acc.totalTokens).toBe(2)
  })

  it('accumulates reasoning via the reasoning parameter', () => {
    const acc = createAccumulator()
    processStreamChunk(acc, '', 'Thinking step 1')
    processStreamChunk(acc, '', ' and step 2')
    expect(acc.thinking).toBe('Thinking step 1 and step 2')
    expect(acc.content).toBe('')
    expect(acc.thinkingTokens).toBe(2)
  })

  it('handles inline <think> tags in text', () => {
    const acc = createAccumulator()
    processStreamChunk(acc, '<think>reasoning here</think>actual content', '')
    expect(acc.thinking).toBe('reasoning here')
    expect(acc.content).toBe('actual content')
    expect(acc.inThinkTag).toBe(false)
    // thinkingTokens should count chunks consistently (1 chunk had thinking)
    expect(acc.thinkingTokens).toBe(1)
  })

  it('handles split <think> tags across chunks', () => {
    const acc = createAccumulator()
    processStreamChunk(acc, '<think>start', '')
    expect(acc.inThinkTag).toBe(true)
    expect(acc.content).toBe('')

    processStreamChunk(acc, ' middle', '')
    expect(acc.inThinkTag).toBe(true)

    processStreamChunk(acc, ' end</think>visible', '')
    expect(acc.inThinkTag).toBe(false)
    expect(acc.thinking).toContain('start')
    expect(acc.thinking).toContain('middle')
    expect(acc.thinking).toContain('end')
    expect(acc.content).toBe('visible')
    // 3 chunks each had thinking content → thinkingTokens should be 3
    expect(acc.thinkingTokens).toBe(3)
  })

  it('increments totalTokens', () => {
    const acc = createAccumulator()
    processStreamChunk(acc, 'a', '')
    processStreamChunk(acc, 'b', '')
    processStreamChunk(acc, '', 'c')
    expect(acc.totalTokens).toBe(3)
  })

  it('sets streamStartTime on first token', () => {
    const acc = createAccumulator()
    expect(acc.streamStartTime).toBeNull()
    processStreamChunk(acc, 'x', '')
    expect(acc.streamStartTime).not.toBeNull()
  })

  it('handles content before <think> tag', () => {
    const acc = createAccumulator()
    processStreamChunk(acc, 'prefix<think>inner</think>suffix', '')
    expect(acc.content).toBe('prefixsuffix')
    expect(acc.thinking).toBe('inner')
  })

  it('handles no-op chunk (empty text and reasoning)', () => {
    const acc = createAccumulator()
    processStreamChunk(acc, '', '')
    expect(acc.totalTokens).toBe(0)
    expect(acc.content).toBe('')
  })
})
