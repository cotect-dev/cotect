import { describe, it, expect } from 'vitest'
import { computeChurn, computeHotspots, type FileChurn } from './gitAnalysis'
import type { GitLogEntry } from '@/store/git'
import type { FileMetrics } from '@/services/structureAnalyzer'

function makeEntry(
  files: { path: string; insertions?: number; deletions?: number }[],
  timestamp: number = 1000,
): GitLogEntry {
  return {
    hash: 'abc1234',
    message: 'test commit',
    body: '',
    author: 'test',
    timestamp,
    insertions: 0,
    deletions: 0,
    files: files.map((f) => ({
      path: f.path,
      insertions: f.insertions ?? 1,
      deletions: f.deletions ?? 0,
    })),
  }
}

const known = new Set(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'])

describe('computeChurn', () => {
  it('counts file appearances across commits', () => {
    const log = [
      makeEntry([{ path: 'src/a.ts' }, { path: 'src/b.ts' }]),
      makeEntry([{ path: 'src/a.ts' }, { path: 'src/c.ts' }]),
      makeEntry([{ path: 'src/a.ts' }]),
    ]
    const result = computeChurn(log, known)
    const a = result.find((c) => c.path === 'src/a.ts')
    expect(a?.commitCount).toBe(3)
    const b = result.find((c) => c.path === 'src/b.ts')
    expect(b?.commitCount).toBe(1)
  })

  it('sums insertions and deletions', () => {
    const log = [
      makeEntry([{ path: 'src/a.ts', insertions: 10, deletions: 5 }]),
      makeEntry([{ path: 'src/a.ts', insertions: 3, deletions: 2 }]),
    ]
    const result = computeChurn(log, known)
    const a = result.find((c) => c.path === 'src/a.ts')!
    expect(a.totalInsertions).toBe(13)
    expect(a.totalDeletions).toBe(7)
  })

  it('tracks last modified timestamp', () => {
    const log = [
      makeEntry([{ path: 'src/a.ts' }], 500),
      makeEntry([{ path: 'src/a.ts' }], 900),
      makeEntry([{ path: 'src/a.ts' }], 100),
    ]
    const result = computeChurn(log, known)
    expect(result[0].lastModified).toBe(900)
  })

  it('filters to known files only', () => {
    const log = [makeEntry([{ path: 'src/a.ts' }, { path: 'src/unknown.ts' }])]
    const result = computeChurn(log, known)
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('src/a.ts')
  })

  it('returns sorted by commit count descending', () => {
    const log = [
      makeEntry([{ path: 'src/b.ts' }]),
      makeEntry([{ path: 'src/a.ts' }, { path: 'src/b.ts' }]),
      makeEntry([{ path: 'src/a.ts' }, { path: 'src/b.ts' }, { path: 'src/c.ts' }]),
    ]
    const result = computeChurn(log, known)
    expect(result[0].path).toBe('src/b.ts')
    expect(result[0].commitCount).toBe(3)
  })

  it('returns empty for empty log', () => {
    expect(computeChurn([], known)).toEqual([])
  })
})

describe('computeHotspots', () => {
  const baseMetrics: FileMetrics[] = [
    {
      path: 'src/a.ts',
      folder: 'src',
      layer: 'lib',
      lineCount: 100,
      inDegree: 10,
      outDegree: 2,
      isTest: false,
      hasTest: false,
      longestChainDepth: 1,
    },
    {
      path: 'src/b.ts',
      folder: 'src',
      layer: 'lib',
      lineCount: 50,
      inDegree: 8,
      outDegree: 1,
      isTest: false,
      hasTest: false,
      longestChainDepth: 0,
    },
    {
      path: 'src/c.ts',
      folder: 'src',
      layer: 'lib',
      lineCount: 30,
      inDegree: 1,
      outDegree: 0,
      isTest: false,
      hasTest: false,
      longestChainDepth: 0,
    },
    {
      path: 'src/d.ts',
      folder: 'src',
      layer: 'lib',
      lineCount: 20,
      inDegree: 0,
      outDegree: 0,
      isTest: true,
      hasTest: false,
      longestChainDepth: 0,
    },
  ]

  const churnFor = (entries: [string, number][]): FileChurn[] =>
    entries.map(([path, commitCount]) => ({
      path,
      commitCount,
      totalInsertions: 0,
      totalDeletions: 0,
      lastModified: 1000,
    }))

  it('ranks the large, high-churn file highest', () => {
    const result = computeHotspots(
      churnFor([
        ['src/a.ts', 20],
        ['src/b.ts', 18],
        ['src/c.ts', 3],
      ]),
      baseMetrics,
    )
    expect(result[0].path).toBe('src/a.ts')
    expect(result[0].hotspotScore).toBeGreaterThanOrEqual(result[1].hotspotScore)
  })

  it('excludes test files even with high churn', () => {
    const result = computeHotspots(churnFor([['src/d.ts', 50]]), baseMetrics)
    expect(result.find((h) => h.path === 'src/d.ts')).toBeUndefined()
  })

  it('excludes files changed only once', () => {
    const result = computeHotspots(churnFor([['src/a.ts', 1]]), baseMetrics)
    expect(result).toHaveLength(0)
  })

  it('excludes zero-line files', () => {
    const zero = baseMetrics.map((m) => (m.path === 'src/a.ts' ? { ...m, lineCount: 0 } : m))
    const result = computeHotspots(churnFor([['src/a.ts', 20]]), zero)
    expect(result.find((h) => h.path === 'src/a.ts')).toBeUndefined()
  })

  it('returns empty for empty inputs', () => {
    expect(computeHotspots([], baseMetrics)).toEqual([])
    expect(computeHotspots(churnFor([['src/a.ts', 10]]), [])).toEqual([])
  })

  it('carries factors for the why-line', () => {
    const result = computeHotspots(churnFor([['src/a.ts', 20]]), baseMetrics)
    expect(result[0]).toMatchObject({ commitCount: 20, lineCount: 100, inDegree: 10 })
  })
})
