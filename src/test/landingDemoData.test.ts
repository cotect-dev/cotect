import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEMO_ROOT,
  GRAPH_NODES,
  GRAPH_EDGES,
  HEALTH_DATA,
  buildCanvasSeed,
  seedDemoStores,
} from '../../landing/demoData'
import { DEMO_FILE_PATH } from '../../landing/demoCode'
import { useCanvasStore, useGraphStore, useHealthStore, useBrowserStore } from '@/store'
import { useGitStore } from '@/store/git'

describe('demo dataset consistency', () => {
  it('graph edges reference existing graph nodes', () => {
    const ids = new Set(GRAPH_NODES.map((n) => n.id))
    for (const e of GRAPH_EDGES) {
      expect(ids.has(e.source), e.source).toBe(true)
      expect(ids.has(e.target), e.target).toBe(true)
    }
  })

  it('health data references existing graph nodes', () => {
    const ids = new Set(GRAPH_NODES.map((n) => n.id))
    for (const f of HEALTH_DATA.findings) {
      for (const file of f.files) expect(ids.has(file), file).toBe(true)
    }
    for (const m of HEALTH_DATA.metrics) expect(ids.has(m.path), m.path).toBe(true)
    for (const h of HEALTH_DATA.hotspots) expect(ids.has(h.path), h.path).toBe(true)
  })

  it('canvas seed contains the agent-changed code node with a diff base', () => {
    const seed = buildCanvasSeed()
    const codeNode = seed.nodes.find((n) => n.type === 'codeNode')
    expect(codeNode).toBeDefined()
    expect(codeNode!.data.filePath).toBe(`${DEMO_ROOT}/${DEMO_FILE_PATH}`)
    expect(typeof codeNode!.data.headOverride).toBe('string')
  })

  it('all canvas nodes are positioned (no two nodes at the same point)', () => {
    const seed = buildCanvasSeed()
    const keys = new Set(seed.nodes.map((n) => `${n.position.x}:${n.position.y}`))
    expect(keys.size).toBe(seed.nodes.length)
  })

  it('graph node degrees match the edge list', () => {
    const inDeg = new Map<string, number>()
    const outDeg = new Map<string, number>()
    for (const e of GRAPH_EDGES) {
      outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1)
      inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1)
    }
    for (const n of GRAPH_NODES) {
      expect(n.inDegree, `${n.id} inDegree`).toBe(inDeg.get(n.id) ?? 0)
      expect(n.outDegree, `${n.id} outDegree`).toBe(outDeg.get(n.id) ?? 0)
      expect(n.score, `${n.id} score`).toBe(n.inDegree + n.outDegree)
    }
  })

  it('churn paths reference existing graph nodes', () => {
    const ids = new Set(GRAPH_NODES.map((n) => n.id))
    for (const c of HEALTH_DATA.churn) expect(ids.has(c.path), c.path).toBe(true)
  })

  it('hotspots agree with graph nodes and churn', () => {
    const byId = new Map(GRAPH_NODES.map((n) => [n.id, n]))
    const churnByPath = new Map(HEALTH_DATA.churn.map((c) => [c.path, c]))
    for (const h of HEALTH_DATA.hotspots) {
      expect(h.lineCount, `${h.path} lineCount`).toBe(byId.get(h.path)?.lineCount)
      expect(h.inDegree, `${h.path} inDegree`).toBe(byId.get(h.path)?.inDegree)
      expect(h.commitCount, `${h.path} commitCount`).toBe(churnByPath.get(h.path)?.commitCount)
      expect(h.hotspotScore, `${h.path} score`).toBeCloseTo(h.churnScore * h.sizeScore, 10)
    }
  })
})

describe('seedDemoStores', () => {
  beforeEach(() => seedDemoStores())

  it('seeds browser root and matching canvas root column so initRoot is skipped', () => {
    expect(useBrowserStore.getState().rootPath).toBe(DEMO_ROOT)
    expect(useCanvasStore.getState().columns[0]?.path).toBe(DEMO_ROOT)
  })

  it('seeds graph as ready so Graph renders without scanning', () => {
    const g = useGraphStore.getState()
    expect(g.scanState).toBe('ready')
    expect(g.allNodes.length).toBeGreaterThan(8)
    expect(g.allEdges.length).toBeGreaterThan(8)
  })

  it('seeds health as ready with analyzedRoot matching rootPath so analyze() is skipped', () => {
    const h = useHealthStore.getState()
    expect(h.scanState).toBe('ready')
    expect(h.analyzedRoot).toBe(DEMO_ROOT)
    expect(h.findings.length).toBeGreaterThan(2)
    expect(h.metrics.length).toBeGreaterThan(8)
    expect(h.hotspots.length).toBeGreaterThan(2)
    expect(h.fileSizes.length).toBeGreaterThan(8)
  })

  it('seeds git so the demo file reads as modified', () => {
    const git = useGitStore.getState()
    expect(git.isGitRepo).toBe(true)
    expect(git.status?.files.some((f) => f.path === DEMO_FILE_PATH)).toBe(true)
    expect(git.workingDiff.some((f) => f.path === DEMO_FILE_PATH)).toBe(true)
    expect(git.log?.[0]?.hash).toBeTruthy()
  })

  it('focuses the changed file on the canvas', () => {
    const s = useCanvasStore.getState()
    expect(s.focusedNodeId).toBeTruthy()
    const focused = s.nodes.find((n) => n.id === s.focusedNodeId)
    expect(focused).toBeDefined()
  })
})
