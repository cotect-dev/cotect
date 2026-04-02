import type { Node, Edge } from '@xyflow/react'
import { NODE_WIDTH, NODE_HEIGHT, NODE_H_GAP, NODE_V_GAP } from '@/lib/constants'

export function layoutTree<T extends Node>(
  nodes: T[],
  edges: Edge[],
): { nodes: T[]; edges: Edge[] } {
  if (nodes.length === 0) return { nodes, edges }

  const children = new Map<string, string[]>()
  const hasParent = new Set<string>()

  for (const edge of edges) {
    const list = children.get(edge.source) || []
    list.push(edge.target)
    children.set(edge.source, list)
    hasParent.add(edge.target)
  }

  const roots = nodes.filter((n) => !hasParent.has(n.id))
  const inEdge = new Set([...hasParent, ...children.keys()])
  const standalone = nodes.filter((n) => !inEdge.has(n.id))

  const positioned = new Map<string, { x: number; y: number }>()

  function positionSubtree(nodeId: string, x: number, y: number): number {
    const kids = children.get(nodeId) || []
    if (kids.length === 0) {
      positioned.set(nodeId, { x, y })
      return NODE_WIDTH
    }

    let totalWidth = 0
    for (let i = 0; i < kids.length; i++) {
      const childWidth = positionSubtree(kids[i], x + totalWidth, y + NODE_HEIGHT + NODE_V_GAP)
      totalWidth += childWidth + (i < kids.length - 1 ? NODE_H_GAP : 0)
    }

    const subtreeWidth = Math.max(totalWidth, NODE_WIDTH)
    positioned.set(nodeId, { x: x + (subtreeWidth - NODE_WIDTH) / 2, y })
    return subtreeWidth
  }

  let offsetX = 0
  for (const root of roots.filter((r) => !standalone.includes(r))) {
    const width = positionSubtree(root.id, offsetX, 0)
    offsetX += width + NODE_H_GAP * 2
  }

  const cols = Math.max(1, Math.ceil(Math.sqrt(standalone.length)))
  const standaloneOffsetX = offsetX > 0 && standalone.length > 0 ? offsetX : 0
  standalone.forEach((node, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    positioned.set(node.id, {
      x: standaloneOffsetX + col * (NODE_WIDTH + NODE_H_GAP),
      y: row * (NODE_HEIGHT + NODE_V_GAP),
    })
  })

  const layoutNodes = nodes.map((node) => ({
    ...node,
    position: positioned.get(node.id) || node.position,
  }))

  return { nodes: layoutNodes, edges }
}
