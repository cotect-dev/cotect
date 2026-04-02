import type { Node, Edge } from '@xyflow/react'
import { NODE_WIDTH, NODE_HEIGHT, NODE_H_GAP, NODE_V_GAP } from '@/lib/constants'

/**
 * Column layout algorithm for directory-level views.
 * Files are placed in a vertical stack on the left column,
 * folders in a vertical stack on the right column.
 * For file-level views with edges (class->method), subtrees
 * are positioned using the tree layout within the files column.
 */
export function layoutTree<T extends Node>(
  nodes: T[],
  edges: Edge[],
): { nodes: T[]; edges: Edge[] } {
  if (nodes.length === 0) return { nodes, edges }

  // Build parent-child relationship map from edges
  const children = new Map<string, string[]>()
  const hasParent = new Set<string>()

  for (const edge of edges) {
    const list = children.get(edge.source) || []
    list.push(edge.target)
    children.set(edge.source, list)
    hasParent.add(edge.target)
  }

  // Separate nodes with edges (tree nodes) from standalone nodes
  const inEdge = new Set([...hasParent, ...children.keys()])
  const treeRoots = nodes.filter((n) => inEdge.has(n.id) && !hasParent.has(n.id))
  const standalone = nodes.filter((n) => !inEdge.has(n.id))

  // Separate standalone nodes into files and folders columns
  const files = standalone.filter((n) => n.type !== 'folder')
  const folders = standalone.filter((n) => n.type === 'folder')

  const positioned = new Map<string, { x: number; y: number }>()

  // Subtree positioning for tree structures (file-level view)
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

  // Position tree roots (used in file-level view)
  let treeOffsetX = 0
  let treeMaxY = 0
  for (const root of treeRoots) {
    const width = positionSubtree(root.id, treeOffsetX, 0)
    treeOffsetX += width + NODE_H_GAP * 2

    for (const [, pos] of positioned) {
      if (pos.y > treeMaxY) treeMaxY = pos.y
    }
  }

  if (treeRoots.length > 0) {
    // Files (standalone, non-folder) below trees
    let fileY = treeMaxY > 0 ? treeMaxY + NODE_HEIGHT + NODE_V_GAP : 0
    for (const file of files) {
      positioned.set(file.id, { x: 0, y: fileY })
      fileY += NODE_HEIGHT + NODE_V_GAP
    }

    // Folders to the right of the tree area
    const folderX = Math.max(treeOffsetX, NODE_WIDTH + NODE_H_GAP)
    let folderY = 0
    for (const folder of folders) {
      positioned.set(folder.id, { x: folderX, y: folderY })
      folderY += NODE_HEIGHT + NODE_V_GAP
    }
  } else {
    // Pure directory view — files left column, folders right column
    let fileY = 0
    for (const file of files) {
      positioned.set(file.id, { x: 0, y: fileY })
      fileY += NODE_HEIGHT + NODE_V_GAP
    }

    const folderX = files.length > 0 ? NODE_WIDTH + NODE_H_GAP : 0
    let folderY = 0
    for (const folder of folders) {
      positioned.set(folder.id, { x: folderX, y: folderY })
      folderY += NODE_HEIGHT + NODE_V_GAP
    }
  }

  const layoutNodes = nodes.map((node) => ({
    ...node,
    position: positioned.get(node.id) || node.position,
  }))

  return { nodes: layoutNodes, edges }
}
