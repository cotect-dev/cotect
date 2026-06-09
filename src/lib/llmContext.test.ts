import { describe, it, expect } from 'vitest'
import { estimateTokens, computeFileSizes, DEFAULT_CONTEXT_WINDOW } from './llmContext'
import type { FileMetrics } from '@/services/structureAnalyzer'

const m = (path: string, lineCount: number, isTest = false): FileMetrics => ({
  path,
  folder: 'src',
  layer: 'lib',
  lineCount,
  inDegree: 0,
  outDegree: 0,
  isTest,
  longestChainDepth: 0,
})

describe('estimateTokens', () => {
  it('estimates ~4 chars per token', () => {
    expect(estimateTokens(0)).toBe(0)
    expect(estimateTokens(400)).toBe(100)
  })
})

describe('computeFileSizes', () => {
  it('sorts by tokens descending and flags risky files', () => {
    const metrics = [m('src/small.ts', 10), m('src/big.ts', 2000)]
    const chars = new Map([
      ['src/small.ts', 400],
      ['src/big.ts', 40_000],
    ])
    const result = computeFileSizes(metrics, chars, DEFAULT_CONTEXT_WINDOW, 1000)
    expect(result.map((r) => r.path)).toEqual(['src/big.ts', 'src/small.ts'])
    expect(result[0].isRisky).toBe(true)
    expect(result[1].isRisky).toBe(false)
    expect(result[0].contextFraction).toBeCloseTo(10_000 / DEFAULT_CONTEXT_WINDOW)
  })

  it('excludes test files and zero-size files', () => {
    const metrics = [m('src/t.test.ts', 100, true), m('src/empty.ts', 0)]
    const chars = new Map([
      ['src/t.test.ts', 4000],
      ['src/empty.ts', 0],
    ])
    expect(computeFileSizes(metrics, chars)).toEqual([])
  })
})
