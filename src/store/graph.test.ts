import { describe, it, expect } from 'vitest'
import { computeVisibleNodeIds, scoreNodes, DEFAULT_HUB_COUNT } from '@/store/graph'
import type { GraphFileNode, GraphFileEdge } from '@/store/graph'

function makeNode(id: string, inDeg: number, outDeg: number): GraphFileNode {
  return {
    id,
    label: id.split('/').pop()!,
    folder: id.slice(0, id.lastIndexOf('/')),
    language: 'typescript',
    inDegree: inDeg,
    outDegree: outDeg,
    score: inDeg + outDeg,
    isTestFile: id.includes('.test.') || id.includes('.spec.'),
  }
}

describe('scoreNodes', () => {
  it('computes inDegree, outDegree, and score from edges', () => {
    const nodes: GraphFileNode[] = [
      makeNode('a.ts', 0, 0),
      makeNode('b.ts', 0, 0),
      makeNode('c.ts', 0, 0),
    ]
    const edges: GraphFileEdge[] = [
      { source: 'a.ts', target: 'b.ts' },
      { source: 'a.ts', target: 'c.ts' },
      { source: 'c.ts', target: 'b.ts' },
    ]
    const scored = scoreNodes(nodes, edges)

    const a = scored.find((n) => n.id === 'a.ts')!
    expect(a.outDegree).toBe(2)
    expect(a.inDegree).toBe(0)
    expect(a.score).toBe(2)

    const b = scored.find((n) => n.id === 'b.ts')!
    expect(b.inDegree).toBe(2)
    expect(b.outDegree).toBe(0)
    expect(b.score).toBe(2)

    const c = scored.find((n) => n.id === 'c.ts')!
    expect(c.inDegree).toBe(1)
    expect(c.outDegree).toBe(1)
    expect(c.score).toBe(2)
  })
})

describe('computeVisibleNodeIds', () => {
  it('returns all nodes when count <= DEFAULT_HUB_COUNT', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => makeNode(`f${i}.ts`, i, 0))
    const result = computeVisibleNodeIds(nodes, false)
    expect(result.size).toBe(10)
  })

  it('returns top DEFAULT_HUB_COUNT nodes by score when showAll is false', () => {
    const nodes = Array.from({ length: 50 }, (_, i) => makeNode(`f${i}.ts`, i, 0))
    const scored = nodes.map((n) => ({ ...n, score: n.inDegree + n.outDegree }))
    const result = computeVisibleNodeIds(scored, false)
    expect(result.size).toBe(DEFAULT_HUB_COUNT)
    expect(result.has('f49.ts')).toBe(true)
    expect(result.has('f48.ts')).toBe(true)
  })

  it('returns all nodes when showAll is true', () => {
    const nodes = Array.from({ length: 50 }, (_, i) => makeNode(`f${i}.ts`, i, 0))
    const result = computeVisibleNodeIds(nodes, true)
    expect(result.size).toBe(50)
  })
})
