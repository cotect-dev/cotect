import { describe, it, expect } from 'vitest'
import { analyzeGraph } from './structureAnalyzer'

describe('analyzeGraph', () => {
  it('returns empty findings for a fully connected project', () => {
    const files = [
      'src/main.tsx',
      'src/lib/utils.ts',
      'src/lib/utils.test.ts',
      'src/services/api.ts',
      'src/services/api.test.ts',
    ]
    const edges: [string, string][] = [
      ['src/main.tsx', 'src/services/api.ts'],
      ['src/services/api.ts', 'src/lib/utils.ts'],
    ]

    const result = analyzeGraph(files, edges)
    expect(result.findings).toEqual([])
    expect(result.metrics).toHaveLength(5)
  })

  it('detects orphan files', () => {
    const files = ['src/lib/utils.ts', 'src/lib/orphan.ts', 'src/services/api.ts']
    const edges: [string, string][] = [['src/services/api.ts', 'src/lib/utils.ts']]

    const result = analyzeGraph(files, edges)
    const orphans = result.findings.filter((f) => f.type === 'orphan')
    expect(orphans.length).toBeGreaterThanOrEqual(1)
    expect(orphans.flatMap((f) => f.files)).toContain('src/lib/orphan.ts')
  })

  it('detects high fan-in', () => {
    const shared = 'src/lib/shared.ts'
    const components = Array.from({ length: 12 }, (_, i) => `src/components/c${i}.ts`)
    const files = [shared, ...components]
    const edges: [string, string][] = components.map((c) => [c, shared])

    const result = analyzeGraph(files, edges, { fanInThreshold: 10 })
    const fanIn = result.findings.filter((f) => f.type === 'high-fan-in')
    expect(fanIn).toHaveLength(1)
    expect(fanIn[0].files).toContain(shared)
  })

  it('detects high fan-out', () => {
    const deps = Array.from({ length: 16 }, (_, i) => `src/lib/dep${i}.ts`)
    const consumer = 'src/services/consumer.ts'
    const files = [consumer, ...deps]
    const edges: [string, string][] = deps.map((d) => [consumer, d])

    const result = analyzeGraph(files, edges, { fanOutThreshold: 15 })
    const fanOut = result.findings.filter((f) => f.type === 'high-fan-out')
    expect(fanOut).toHaveLength(1)
    expect(fanOut[0].files).toContain(consumer)
  })

  it('detects god module (high fan-in + fan-out)', () => {
    const god = 'src/services/god.ts'
    const importers = Array.from({ length: 10 }, (_, i) => `src/components/i${i}.ts`)
    const deps = Array.from({ length: 15 }, (_, i) => `src/lib/d${i}.ts`)
    const files = [god, ...importers, ...deps]
    const edges: [string, string][] = [
      ...importers.map((i): [string, string] => [i, god]),
      ...deps.map((d): [string, string] => [god, d]),
    ]

    const result = analyzeGraph(files, edges, { fanInThreshold: 10, fanOutThreshold: 15 })
    const gods = result.findings.filter((f) => f.type === 'god-module')
    expect(gods).toHaveLength(1)
    expect(gods[0].files).toContain(god)
  })

  it('detects circular dependencies', () => {
    const files = ['src/services/a.ts', 'src/services/b.ts', 'src/services/c.ts']
    const edges: [string, string][] = [
      ['src/services/a.ts', 'src/services/b.ts'],
      ['src/services/b.ts', 'src/services/c.ts'],
      ['src/services/c.ts', 'src/services/a.ts'],
    ]

    const result = analyzeGraph(files, edges)
    const cycles = result.findings.filter((f) => f.type === 'circular-dependency')
    expect(cycles).toHaveLength(1)
    expect(cycles[0].severity).toBe('error')
    expect(cycles[0].files).toHaveLength(3)
  })

  it('detects layer violations (lower layer importing higher)', () => {
    const files = ['src/lib/utils.ts', 'src/components/button.ts']
    const edges: [string, string][] = [['src/lib/utils.ts', 'src/components/button.ts']]

    const result = analyzeGraph(files, edges)
    const violations = result.findings.filter((f) => f.type === 'layer-violation')
    expect(violations).toHaveLength(1)
    expect(violations[0].severity).toBe('warning')
  })

  it('detects deep dependency chains', () => {
    const files = Array.from({ length: 10 }, (_, i) => `src/lib/f${i}.ts`)
    const edges: [string, string][] = []
    for (let i = 0; i < 9; i++) {
      edges.push([files[i], files[i + 1]])
    }

    const result = analyzeGraph(files, edges, { depthThreshold: 8 })
    const deep = result.findings.filter((f) => f.type === 'deep-chain')
    expect(deep.length).toBeGreaterThanOrEqual(1)
  })

  it('detects hub bottleneck (imported from 3+ layers)', () => {
    const hub = 'src/lib/hub.ts'
    const importers = [
      'src/services/s1.ts',
      'src/services/s2.ts',
      'src/store/st1.ts',
      'src/hooks/h1.ts',
      'src/components/c1.ts',
      'src/views/v1.ts',
    ]
    const files = [hub, ...importers]
    const edges: [string, string][] = importers.map((i) => [i, hub])

    const result = analyzeGraph(files, edges, { fanInThreshold: 10 })
    const hubs = result.findings.filter((f) => f.type === 'hub-bottleneck')
    expect(hubs).toHaveLength(1)
    expect(hubs[0].files).toContain(hub)
  })

  it('sorts findings by severity (errors first)', () => {
    const files = [
      'src/services/a.ts',
      'src/services/b.ts',
      'src/lib/orphan.ts',
      'src/lib/utils.ts',
      'src/components/button.ts',
    ]
    const edges: [string, string][] = [
      ['src/services/a.ts', 'src/services/b.ts'],
      ['src/services/b.ts', 'src/services/a.ts'],
      ['src/lib/utils.ts', 'src/components/button.ts'],
    ]

    const result = analyzeGraph(files, edges)
    const sev = { error: 0, warning: 1, info: 2 } as const
    for (let i = 1; i < result.findings.length; i++) {
      expect(sev[result.findings[i - 1].severity]).toBeLessThanOrEqual(
        sev[result.findings[i].severity],
      )
    }
  })

  it('returns graph nodes and edges', () => {
    const files = ['src/lib/utils.ts', 'src/services/api.ts']
    const edges: [string, string][] = [['src/services/api.ts', 'src/lib/utils.ts']]

    const result = analyzeGraph(files, edges)
    expect(result.graph.nodes).toHaveLength(2)
    expect(result.graph.edges).toEqual(edges)
  })

  it('computes metrics for each file', () => {
    const files = ['src/lib/utils.ts', 'src/store/app.ts']
    const edges: [string, string][] = [['src/store/app.ts', 'src/lib/utils.ts']]

    const result = analyzeGraph(files, edges)
    const utilsMetric = result.metrics.find((m) => m.path === 'src/lib/utils.ts')
    expect(utilsMetric).toBeDefined()
    expect(utilsMetric!.layer).toBe('lib')
    expect(utilsMetric!.inDegree).toBe(1)
    expect(utilsMetric!.outDegree).toBe(0)
  })

  it('skips test files for findings', () => {
    const files = ['src/lib/utils.test.ts']
    const edges: [string, string][] = []

    const result = analyzeGraph(files, edges)
    expect(result.findings).toEqual([])
    expect(result.metrics[0].isTest).toBe(true)
  })

  it('does not flag entry points as orphans', () => {
    const files = ['src/main.tsx', 'src/App.tsx', 'src/lib/utils.ts']
    const edges: [string, string][] = [
      ['src/main.tsx', 'src/lib/utils.ts'],
      ['src/main.tsx', 'src/App.tsx'],
    ]

    const result = analyzeGraph(files, edges)
    const orphans = result.findings.filter((f) => f.type === 'orphan')
    expect(orphans).toHaveLength(0)
  })

  it('flags large files', () => {
    const files = ['src/main.tsx', 'src/lib/big.ts']
    const edges: [string, string][] = [['src/main.tsx', 'src/lib/big.ts']]
    const lineCounts = new Map([
      ['src/main.tsx', 50],
      ['src/lib/big.ts', 400],
    ])

    const result = analyzeGraph(files, edges, { largeFileThreshold: 300 }, lineCounts)
    const large = result.findings.filter((f) => f.type === 'large-file')
    expect(large).toHaveLength(1)
    expect(large[0].files).toContain('src/lib/big.ts')
    expect(large[0].message).toContain('400 lines')
  })

  it('escalates very large files to warning severity', () => {
    const files = ['src/main.tsx', 'src/lib/huge.ts']
    const edges: [string, string][] = [['src/main.tsx', 'src/lib/huge.ts']]
    const lineCounts = new Map([
      ['src/main.tsx', 50],
      ['src/lib/huge.ts', 700],
    ])

    const result = analyzeGraph(files, edges, { largeFileThreshold: 300 }, lineCounts)
    const large = result.findings.filter((f) => f.type === 'large-file')
    expect(large).toHaveLength(1)
    expect(large[0].severity).toBe('warning')
  })

  it('includes lineCount in metrics', () => {
    const files = ['src/lib/a.ts']
    const lineCounts = new Map([['src/lib/a.ts', 150]])

    const result = analyzeGraph(files, [], {}, lineCounts)
    expect(result.metrics[0].lineCount).toBe(150)
  })

  it('defaults lineCount to 0 when not provided', () => {
    const files = ['src/lib/a.ts']
    const result = analyzeGraph(files, [])
    expect(result.metrics[0].lineCount).toBe(0)
  })

  it('flags wide folders', () => {
    const files = Array.from({ length: 16 }, (_, i) => `src/lib/f${i}.ts`)
    const edges: [string, string][] = []

    const result = analyzeGraph(files, edges, { wideFolderThreshold: 15 })
    const wide = result.findings.filter((f) => f.type === 'wide-folder')
    expect(wide).toHaveLength(1)
    expect(wide[0].message).toContain('16 files')
  })

  it('flags missing tests for files with enough outgoing imports', () => {
    const files = [
      'src/main.tsx',
      'src/services/api.ts',
      'src/lib/a.ts',
      'src/lib/b.ts',
      'src/lib/c.ts',
    ]
    const edges: [string, string][] = [
      ['src/services/api.ts', 'src/lib/a.ts'],
      ['src/services/api.ts', 'src/lib/b.ts'],
      ['src/services/api.ts', 'src/lib/c.ts'],
      ['src/main.tsx', 'src/services/api.ts'],
    ]

    const result = analyzeGraph(files, edges)
    const missing = result.findings.filter((f) => f.type === 'missing-test')
    const paths = missing.flatMap((f) => f.files)
    expect(paths).toContain('src/services/api.ts')
  })

  it('does not flag missing tests for simple files with few imports', () => {
    const files = ['src/main.tsx', 'src/lib/helper.ts', 'src/lib/dep.ts']
    const edges: [string, string][] = [
      ['src/lib/helper.ts', 'src/lib/dep.ts'],
      ['src/main.tsx', 'src/lib/helper.ts'],
    ]

    const result = analyzeGraph(files, edges)
    const missing = result.findings.filter((f) => f.type === 'missing-test')
    const paths = missing.flatMap((f) => f.files)
    expect(paths).not.toContain('src/lib/helper.ts')
  })

  it('does not flag missing test when test file exists', () => {
    const files = ['src/main.tsx', 'src/services/api.ts', 'src/services/api.test.ts']
    const edges: [string, string][] = [['src/services/api.ts', 'src/main.tsx']]

    const result = analyzeGraph(files, edges)
    const missing = result.findings.filter((f) => f.type === 'missing-test')
    const paths = missing.flatMap((f) => f.files)
    expect(paths).not.toContain('src/services/api.ts')
  })

  it('flags mixed-layer imports', () => {
    const consumer = 'src/views/page.ts'
    const deps = ['src/lib/a.ts', 'src/services/b.ts', 'src/store/c.ts', 'src/hooks/d.ts']
    const files = [consumer, ...deps]
    const edges: [string, string][] = deps.map((d) => [consumer, d])

    const result = analyzeGraph(files, edges, { mixedLayerThreshold: 4 })
    const mixed = result.findings.filter((f) => f.type === 'mixed-layers')
    expect(mixed).toHaveLength(1)
    expect(mixed[0].files).toContain(consumer)
  })

  it('does not flag mixed-layers below threshold', () => {
    const consumer = 'src/views/page.ts'
    const deps = ['src/lib/a.ts', 'src/services/b.ts', 'src/store/c.ts']
    const files = [consumer, ...deps]
    const edges: [string, string][] = deps.map((d) => [consumer, d])

    const result = analyzeGraph(files, edges, { mixedLayerThreshold: 4 })
    const mixed = result.findings.filter((f) => f.type === 'mixed-layers')
    expect(mixed).toHaveLength(0)
  })
})
