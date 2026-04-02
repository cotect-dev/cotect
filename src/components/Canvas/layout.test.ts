import { describe, it, expect } from 'vitest'
import { layoutTree } from './layout'
import type { Node, Edge } from '@xyflow/react'
import { NODE_WIDTH, NODE_HEIGHT, NODE_H_GAP, NODE_V_GAP } from '@/lib/constants'

function makeNode(id: string): Node {
  return { id, position: { x: 0, y: 0 }, data: {} }
}

function makeEdge(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, target }
}

describe('layoutTree', () => {
  it('returns empty result for empty inputs', () => {
    const result = layoutTree([], [])
    expect(result.nodes).toEqual([])
    expect(result.edges).toEqual([])
  })

  it('positions a single standalone node at origin', () => {
    const nodes = [makeNode('a')]
    const result = layoutTree(nodes, [])
    expect(result.nodes[0].position).toEqual({ x: 0, y: 0 })
  })

  it('lays out a simple parent-child pair vertically', () => {
    const nodes = [makeNode('parent'), makeNode('child')]
    const edges = [makeEdge('parent', 'child')]
    const result = layoutTree(nodes, edges)

    const parent = result.nodes.find((n) => n.id === 'parent')!
    const child = result.nodes.find((n) => n.id === 'child')!

    // parent and child should have same x (single child is centered)
    expect(parent.position.x).toBe(child.position.x)
    // child should be below parent
    expect(child.position.y).toBe(parent.position.y + NODE_HEIGHT + NODE_V_GAP)
  })

  it('spaces siblings horizontally', () => {
    const nodes = [makeNode('root'), makeNode('c1'), makeNode('c2')]
    const edges = [makeEdge('root', 'c1'), makeEdge('root', 'c2')]
    const result = layoutTree(nodes, edges)

    const c1 = result.nodes.find((n) => n.id === 'c1')!
    const c2 = result.nodes.find((n) => n.id === 'c2')!

    // c2 should be to the right of c1
    expect(c2.position.x).toBeGreaterThan(c1.position.x)
    // gap should be NODE_H_GAP
    expect(c2.position.x - c1.position.x).toBe(NODE_WIDTH + NODE_H_GAP)
  })

  it('centers the parent over its children', () => {
    const nodes = [makeNode('root'), makeNode('c1'), makeNode('c2')]
    const edges = [makeEdge('root', 'c1'), makeEdge('root', 'c2')]
    const result = layoutTree(nodes, edges)

    const root = result.nodes.find((n) => n.id === 'root')!
    const c1 = result.nodes.find((n) => n.id === 'c1')!
    const c2 = result.nodes.find((n) => n.id === 'c2')!

    // parent should be centered between children
    const childMidpoint = (c1.position.x + c2.position.x) / 2
    expect(root.position.x).toBeCloseTo(childMidpoint, 5)
  })

  it('positions standalone nodes in a grid', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')]
    const result = layoutTree(nodes, [])

    // 4 nodes -> ceil(sqrt(4)) = 2 cols
    const a = result.nodes.find((n) => n.id === 'a')!
    const b = result.nodes.find((n) => n.id === 'b')!
    const c = result.nodes.find((n) => n.id === 'c')!
    const d = result.nodes.find((n) => n.id === 'd')!

    // Row 0: a, b
    expect(a.position.y).toBe(0)
    expect(b.position.y).toBe(0)
    expect(b.position.x).toBeGreaterThan(a.position.x)

    // Row 1: c, d
    expect(c.position.y).toBe(NODE_HEIGHT + NODE_V_GAP)
    expect(d.position.y).toBe(NODE_HEIGHT + NODE_V_GAP)
  })

  it('preserves edges unchanged', () => {
    const nodes = [makeNode('a'), makeNode('b')]
    const edges = [makeEdge('a', 'b')]
    const result = layoutTree(nodes, edges)
    expect(result.edges).toBe(edges) // same reference
  })

  it('handles multiple separate trees', () => {
    const nodes = [
      makeNode('r1'),
      makeNode('c1'),
      makeNode('r2'),
      makeNode('c2'),
    ]
    const edges = [makeEdge('r1', 'c1'), makeEdge('r2', 'c2')]
    const result = layoutTree(nodes, edges)

    const r1 = result.nodes.find((n) => n.id === 'r1')!
    const r2 = result.nodes.find((n) => n.id === 'r2')!

    // Both roots at y=0
    expect(r1.position.y).toBe(0)
    expect(r2.position.y).toBe(0)

    // r2 should be offset from r1
    expect(r2.position.x).toBeGreaterThan(r1.position.x)
  })

  it('handles a deeper tree (3 levels)', () => {
    const nodes = [makeNode('root'), makeNode('mid'), makeNode('leaf')]
    const edges = [makeEdge('root', 'mid'), makeEdge('mid', 'leaf')]
    const result = layoutTree(nodes, edges)

    const root = result.nodes.find((n) => n.id === 'root')!
    const mid = result.nodes.find((n) => n.id === 'mid')!
    const leaf = result.nodes.find((n) => n.id === 'leaf')!

    expect(root.position.y).toBe(0)
    expect(mid.position.y).toBe(NODE_HEIGHT + NODE_V_GAP)
    expect(leaf.position.y).toBe(2 * (NODE_HEIGHT + NODE_V_GAP))
  })

  it('does not overlap standalone nodes with tree nodes', () => {
    const nodes = [makeNode('root'), makeNode('child'), makeNode('standalone')]
    const edges = [makeEdge('root', 'child')]
    const result = layoutTree(nodes, edges)

    const root = result.nodes.find((n) => n.id === 'root')!
    const child = result.nodes.find((n) => n.id === 'child')!
    const standalone = result.nodes.find((n) => n.id === 'standalone')!

    // Standalone node should not overlap with the tree
    const treeMaxX = Math.max(root.position.x, child.position.x) + NODE_WIDTH
    expect(standalone.position.x).toBeGreaterThanOrEqual(treeMaxX)
  })
})
