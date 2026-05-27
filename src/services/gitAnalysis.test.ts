import { describe, it, expect } from 'vitest'
import { computeChurn, computeChangeCoupling, computeHotspots } from './gitAnalysis'
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

describe('computeChangeCoupling', () => {
  it('detects files that frequently change together', () => {
    const log = [
      makeEntry([{ path: 'src/a.ts' }, { path: 'src/b.ts' }]),
      makeEntry([{ path: 'src/a.ts' }, { path: 'src/b.ts' }]),
      makeEntry([{ path: 'src/a.ts' }, { path: 'src/b.ts' }]),
    ]
    const result = computeChangeCoupling(log, known, 3)
    expect(result).toHaveLength(1)
    expect(result[0].coChangeCount).toBe(3)
  })

  it('filters below minCoChanges threshold', () => {
    const log = [
      makeEntry([{ path: 'src/a.ts' }, { path: 'src/b.ts' }]),
      makeEntry([{ path: 'src/a.ts' }, { path: 'src/b.ts' }]),
    ]
    const result = computeChangeCoupling(log, known, 3)
    expect(result).toHaveLength(0)
  })

  it('computes coupling strength', () => {
    const log = [
      makeEntry([{ path: 'src/a.ts' }, { path: 'src/b.ts' }]),
      makeEntry([{ path: 'src/a.ts' }, { path: 'src/b.ts' }]),
      makeEntry([{ path: 'src/a.ts' }, { path: 'src/b.ts' }]),
      makeEntry([{ path: 'src/a.ts' }]),
    ]
    const result = computeChangeCoupling(log, known, 3)
    expect(result[0].couplingStrength).toBe(3 / 4)
  })

  it('handles multi-file commits', () => {
    const log = [
      makeEntry([{ path: 'src/a.ts' }, { path: 'src/b.ts' }, { path: 'src/c.ts' }]),
      makeEntry([{ path: 'src/a.ts' }, { path: 'src/b.ts' }, { path: 'src/c.ts' }]),
      makeEntry([{ path: 'src/a.ts' }, { path: 'src/b.ts' }, { path: 'src/c.ts' }]),
    ]
    const result = computeChangeCoupling(log, known, 3)
    expect(result).toHaveLength(3)
  })

  it('normalizes pair keys regardless of order', () => {
    const log = [
      makeEntry([{ path: 'src/b.ts' }, { path: 'src/a.ts' }]),
      makeEntry([{ path: 'src/a.ts' }, { path: 'src/b.ts' }]),
      makeEntry([{ path: 'src/b.ts' }, { path: 'src/a.ts' }]),
    ]
    const result = computeChangeCoupling(log, known, 3)
    expect(result).toHaveLength(1)
    expect(result[0].coChangeCount).toBe(3)
  })

  it('returns empty for empty log', () => {
    expect(computeChangeCoupling([], known)).toEqual([])
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
      longestChainDepth: 0,
    },
  ]

  it('identifies files with high churn and high fan-in', () => {
    const churn = [
      {
        path: 'src/a.ts',
        commitCount: 20,
        totalInsertions: 100,
        totalDeletions: 50,
        lastModified: 1000,
      },
      {
        path: 'src/b.ts',
        commitCount: 15,
        totalInsertions: 50,
        totalDeletions: 20,
        lastModified: 900,
      },
      {
        path: 'src/c.ts',
        commitCount: 2,
        totalInsertions: 5,
        totalDeletions: 1,
        lastModified: 800,
      },
    ]
    const result = computeHotspots(churn, baseMetrics, 5)
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0].path).toBe('src/a.ts')
  })

  it('excludes test files', () => {
    const churn = [
      {
        path: 'src/d.ts',
        commitCount: 50,
        totalInsertions: 200,
        totalDeletions: 100,
        lastModified: 1000,
      },
    ]
    const metricsWithTestFanIn = baseMetrics.map((m) =>
      m.path === 'src/d.ts' ? { ...m, inDegree: 20 } : m,
    )
    const result = computeHotspots(churn, metricsWithTestFanIn, 5)
    expect(result.find((h) => h.path === 'src/d.ts')).toBeUndefined()
  })

  it('excludes files below fan-in threshold', () => {
    const churn = [
      {
        path: 'src/c.ts',
        commitCount: 50,
        totalInsertions: 200,
        totalDeletions: 100,
        lastModified: 1000,
      },
    ]
    const result = computeHotspots(churn, baseMetrics, 5)
    expect(result).toHaveLength(0)
  })

  it('returns empty for empty inputs', () => {
    expect(computeHotspots([], baseMetrics)).toEqual([])
    expect(
      computeHotspots(
        [
          {
            path: 'src/a.ts',
            commitCount: 10,
            totalInsertions: 0,
            totalDeletions: 0,
            lastModified: 0,
          },
        ],
        [],
      ),
    ).toEqual([])
  })

  it('sorts by hotspot score descending', () => {
    const churn = [
      {
        path: 'src/a.ts',
        commitCount: 20,
        totalInsertions: 100,
        totalDeletions: 50,
        lastModified: 1000,
      },
      {
        path: 'src/b.ts',
        commitCount: 18,
        totalInsertions: 80,
        totalDeletions: 30,
        lastModified: 900,
      },
    ]
    const result = computeHotspots(churn, baseMetrics, 5)
    expect(result.length).toBe(2)
    expect(result[0].hotspotScore).toBeGreaterThanOrEqual(result[1].hotspotScore)
  })
})
