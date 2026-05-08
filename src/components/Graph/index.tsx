import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  BaseEdge,
  Handle,
  Position,
  type Node,
  type Edge,
  type EdgeProps,
  type NodeMouseHandler,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { FileText, FileCode, FlaskConical, Image } from 'lucide-react'
import { useGraphStore, useBrowserStore, useCanvasStore } from '@/store'
import { toRepoRelative } from '@/lib/repoPath'
import { getConfigForFile } from '@/services/treesitter-queries'
import { isImageFile } from '@/lib/constants'
import type { GraphFileNode, GraphFileEdge } from '@/store/graph'

const proOptions = { hideAttribution: true }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NODE_MIN_WIDTH = 100
const NODE_H_PAD = 28   // horizontal padding inside the node (4px border + 10px padding each side + slack)
const NODE_HEIGHT = 36
const NODE_GAP = 20      // gap between adjacent nodes (top/bottom rows)
const SIDE_GAP = 100     // horizontal space between selected node edge and side column edge
const STACK_V_GAP = 12   // vertical gap between vertically stacked nodes

const LANGUAGE_BORDER: Record<string, string> = {
  typescript: '#3b82f6',
  javascript: '#3b82f6',
  python: '#22c55e',
  go: '#f97316',
  rust: '#ef4444',
}

// Edge colors — IDE convention: green = outgoing (this file uses),
// purple/violet = incoming (used by others)
const EDGE_COLOR_DEPENDENCY = '#4ade80'  // green — "this file imports"
const EDGE_COLOR_DEPENDENT  = '#a78bfa'  // violet — "imported by"

// Folder background
const FOLDER_BG = 'rgba(46, 50, 56, 0.6)'
const FOLDER_BORDER = 'rgba(148, 163, 184, 0.15)'
const FOLDER_PAD = 16
const FOLDER_LABEL_H = 22

// ---------------------------------------------------------------------------
// Measure text width using an offscreen canvas
// ---------------------------------------------------------------------------

// Measure text using a hidden DOM element so we inherit the real rendered font
// (Geist Variable) rather than guessing in a canvas context.
let _measureEl: HTMLSpanElement | null = null
function getMeasureEl(): HTMLSpanElement {
  if (!_measureEl) {
    const el = document.createElement('span')
    el.style.cssText =
      'position:absolute;visibility:hidden;height:auto;width:auto;white-space:nowrap;' +
      'font-size:11px;line-height:16px;pointer-events:none;'
    // Inherit font-family from the document body
    el.style.fontFamily = 'inherit'
    document.body.appendChild(el)
    _measureEl = el
  }
  return _measureEl
}

function measureTextWidth(label: string, fontSize: string, fontWeight: string): number {
  const el = getMeasureEl()
  el.style.fontSize = fontSize
  el.style.fontWeight = fontWeight
  el.textContent = label
  return el.getBoundingClientRect().width
}

const NODE_ICON_SPACE = 20 // 14px icon + 6px gap
function measureNodeWidth(label: string, isSelected: boolean): number {
  const textW = measureTextWidth(label, '11px', isSelected ? '600' : '500')
  return Math.max(NODE_MIN_WIDTH, Math.ceil(textW + NODE_H_PAD + NODE_ICON_SPACE))
}

/** Minimum background width needed to fit the folder label without clipping. */
const FOLDER_LABEL_PAD = 24 // 12px left + 12px right inside the background
function measureFolderLabelWidth(label: string): number {
  const textW = measureTextWidth(label, '10px', '500')
  return Math.ceil(textW + FOLDER_LABEL_PAD)
}

/** Pre-compute widths for all ego nodes. Returns a map of nodeId → pixel width. */
function computeNodeWidths(
  egoNodes: EgoNode[],
  selectedId: string,
): Map<string, number> {
  const widths = new Map<string, number>()
  for (const en of egoNodes) {
    widths.set(en.node.id, measureNodeWidth(en.node.label, en.node.id === selectedId))
  }
  return widths
}

// ---------------------------------------------------------------------------
// Custom edge: routes vertically from source, turns horizontally just before
// the target node, then enters the target.
// ---------------------------------------------------------------------------

const STEP_OFFSET = 20
const CORNER_R = 8

function nearTargetPath(
  sx: number, sy: number,
  tx: number, ty: number,
  sourcePos: Position, targetPos: Position,
  turnYOverride?: number,
): string {
  const isSourceVert = sourcePos === Position.Top || sourcePos === Position.Bottom
  const isTargetVert = targetPos === Position.Top || targetPos === Position.Bottom

  if (isSourceVert && isTargetVert) {
    const turnY = turnYOverride ?? (ty > sy ? ty - STEP_OFFSET : ty + STEP_OFFSET)
    const dx = tx - sx

    if (Math.abs(dx) < 1) return `M${sx},${sy} L${tx},${ty}`

    const r = Math.min(CORNER_R, Math.abs(dx) / 2, Math.abs(turnY - sy))
    const dirY = turnY > sy ? 1 : -1
    const dirX = dx > 0 ? 1 : -1

    return [
      `M${sx},${sy}`,
      `L${sx},${turnY - r * dirY}`,
      `Q${sx},${turnY} ${sx + r * dirX},${turnY}`,
      `L${tx - r * dirX},${turnY}`,
      `Q${tx},${turnY} ${tx},${turnY + r * dirY}`,
      `L${tx},${ty}`,
    ].join(' ')
  }

  if (!isSourceVert && !isTargetVert) {
    const turnX = (sx + tx) / 2 // midpoint of the gap — shared branching line
    const dy = ty - sy

    if (Math.abs(dy) < 1) return `M${sx},${sy} L${tx},${ty}`

    const r = Math.min(CORNER_R, Math.abs(dy) / 2, Math.abs(turnX - sx))
    const dirX = turnX > sx ? 1 : -1
    const dirY = dy > 0 ? 1 : -1

    return [
      `M${sx},${sy}`,
      `L${turnX - r * dirX},${sy}`,
      `Q${turnX},${sy} ${turnX},${sy + r * dirY}`,
      `L${turnX},${ty - r * dirY}`,
      `Q${turnX},${ty} ${turnX + r * dirX},${ty}`,
      `L${tx},${ty}`,
    ].join(' ')
  }

  return `M${sx},${sy} L${tx},${ty}`
}

function NearTargetEdge(props: EdgeProps) {
  const turnY = (props.data as { turnY?: number } | undefined)?.turnY
  const path = nearTargetPath(
    props.sourceX, props.sourceY,
    props.targetX, props.targetY,
    props.sourcePosition, props.targetPosition,
    turnY,
  )
  return <BaseEdge path={path} style={props.style} markerEnd={props.markerEnd} />
}

const edgeTypes = { nearTarget: NearTargetEdge }

// ---------------------------------------------------------------------------
// Custom node: auto-sized to fit filename
// ---------------------------------------------------------------------------

interface GraphNodeData {
  folder: string
  filename: string
  borderColor: string
  isSelected: boolean
  isTestFile: boolean
  isParseable: boolean
  isImage: boolean
  isSibling: boolean
  nodeWidth: number
  [key: string]: unknown
}

const handleStyle = { opacity: 0, width: 6, height: 6 } as const

const GraphNodeComponent = memo(({ data }: NodeProps<Node<GraphNodeData>>) => {
  const d = data as GraphNodeData
  const Icon = d.isTestFile ? FlaskConical : d.isImage ? Image : d.isParseable ? FileCode : FileText
  const iconColor = d.isTestFile ? '#ca8a04' : d.isImage ? '#34d399' : d.isParseable ? '#60a5fa' : '#9ca3af'
  const borderStyle = d.isTestFile ? 'dashed' : 'solid'
  const borderColor = d.isSelected ? '#fff' : d.isTestFile ? 'rgba(161,98,7,0.4)' : d.borderColor

  return (
    <div
      style={{
        padding: '4px 10px',
        borderRadius: 6,
        border: `2px ${borderStyle} ${borderColor}`,
        background: d.isSelected ? 'rgba(59,130,246,0.15)' : 'var(--color-card)',
        width: d.nodeWidth,
        height: NODE_HEIGHT,
        boxSizing: 'border-box',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        opacity: d.isTestFile ? 0.6 : d.isSibling ? 0.45 : 1,
      }}
    >
      <Handle type="source" position={Position.Top} id="s-top" style={handleStyle} />
      <Handle type="source" position={Position.Right} id="s-right" style={handleStyle} />
      <Handle type="source" position={Position.Bottom} id="s-bottom" style={handleStyle} />
      <Handle type="source" position={Position.Left} id="s-left" style={handleStyle} />
      <Handle type="target" position={Position.Top} id="t-top" style={handleStyle} />
      <Handle type="target" position={Position.Right} id="t-right" style={handleStyle} />
      <Handle type="target" position={Position.Bottom} id="t-bottom" style={handleStyle} />
      <Handle type="target" position={Position.Left} id="t-left" style={handleStyle} />

      <Icon style={{ width: 14, height: 14, flexShrink: 0, color: iconColor }} />
      <div
        style={{
          fontSize: 11,
          fontWeight: d.isSelected ? 600 : 500,
          color: 'var(--color-foreground)',
          whiteSpace: 'nowrap',
          lineHeight: '16px',
        }}
      >
        {d.filename}
      </div>
    </div>
  )
})
GraphNodeComponent.displayName = 'GraphNode'

// ---------------------------------------------------------------------------
// Folder background node (non-interactive group label)
// ---------------------------------------------------------------------------

interface FolderBgData {
  folderLabel: string
  width: number
  height: number
  [key: string]: unknown
}

const FolderBgComponent = memo(({ data }: NodeProps<Node<FolderBgData>>) => {
  const d = data as FolderBgData
  return (
    <div
      style={{
        width: d.width,
        height: d.height,
        borderRadius: 2,
        background: FOLDER_BG,
        border: `1px solid ${FOLDER_BORDER}`,
        position: 'relative',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 12,
          fontSize: 10,
          fontWeight: 500,
          color: 'var(--color-muted-foreground)',
          opacity: 0.6,
          whiteSpace: 'nowrap',
          lineHeight: '14px',
        }}
      >
        {d.folderLabel}
      </div>
    </div>
  )
})
FolderBgComponent.displayName = 'FolderBg'

const nodeTypes = { graphNode: GraphNodeComponent, folderBg: FolderBgComponent }

// ---------------------------------------------------------------------------
// Direct neighbors + same-folder siblings
// ---------------------------------------------------------------------------

type EgoRelation = 'import' | 'self' | 'imported-by' | 'sibling'

interface EgoNode {
  node: GraphFileNode
  /** Row: -1 = top (diff-folder imports), 0 = center row, 1 = bottom (diff-folder imported-by) */
  depth: number
  /** Relationship to the selected file */
  relation: EgoRelation
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

function directNeighbors(
  startId: string,
  allNodes: GraphFileNode[],
  allEdges: GraphFileEdge[],
  showTests: boolean,
): { nodes: EgoNode[]; edges: GraphFileEdge[] } {
  const nodeMap = new Map(allNodes.map((n) => [n.id, n]))
  const startNode = nodeMap.get(startId)
  if (!startNode) return { nodes: [], edges: [] }

  const centerFolder = startNode.folder || '.'

  const canInclude = (id: string) => {
    const n = nodeMap.get(id)
    return n && (showTests || !n.isTestFile)
  }

  // Find direct imports and imported-by
  const imports = new Set<string>()
  const importedBy = new Set<string>()

  for (const e of allEdges) {
    if (e.source === startId && canInclude(e.target) && e.target !== startId) {
      imports.add(e.target)
    }
  }
  for (const e of allEdges) {
    if (e.target === startId && canInclude(e.source) && e.source !== startId && !imports.has(e.source)) {
      importedBy.add(e.source)
    }
  }

  const result: EgoNode[] = []
  result.push({ node: startNode, depth: 0, relation: 'self' })

  // Same-folder → center row (depth 0), different-folder → top/bottom
  for (const id of imports) {
    const n = nodeMap.get(id)!
    const sameFolder = (n.folder || '.') === centerFolder
    result.push({ node: n, depth: sameFolder ? 0 : -1, relation: 'import' })
  }

  for (const id of importedBy) {
    const n = nodeMap.get(id)!
    const sameFolder = (n.folder || '.') === centerFolder
    result.push({ node: n, depth: sameFolder ? 0 : 1, relation: 'imported-by' })
  }

  // Same-folder siblings (no import relationship) — standalone nodes
  for (const n of allNodes) {
    if (n.id === startId) continue
    if ((n.folder || '.') !== centerFolder) continue
    if (imports.has(n.id) || importedBy.has(n.id)) continue
    if (!showTests && n.isTestFile) continue
    result.push({ node: n, depth: 0, relation: 'sibling' })
  }

  // Only include edges connected to the selected file and between visible nodes
  const visibleIds = new Set(result.map((en) => en.node.id))
  const edges = allEdges.filter((e) =>
    (e.source === startId || e.target === startId) &&
    visibleIds.has(e.source) && visibleIds.has(e.target)
  )

  return { nodes: result, edges }
}

// ---------------------------------------------------------------------------
// Layered layout.
// Center row: selected file + same-folder nodes (imports left, imported-by
// right, siblings at the edges). Top/bottom: different-folder nodes grouped
// by folder.
// ---------------------------------------------------------------------------

const MIN_ROW_SPACING = 120 // minimum center-to-row distance
const ROW_GAP = 60          // minimum visual gap between folder backgrounds
const FOLDER_GROUP_GAP = 60
const SIBLING_GAP = 40      // extra gap before siblings in the center row

function layoutFolderRow(
  row: EgoNode[],
  rowY: number,
  nodeWidths: Map<string, number>,
  positions: Map<string, { x: number; y: number }>,
): void {
  const w = (id: string) => nodeWidths.get(id) ?? NODE_MIN_WIDTH

  const byFolder = new Map<string, EgoNode[]>()
  for (const en of row) {
    const folder = en.node.folder || '.'
    if (!byFolder.has(folder)) byFolder.set(folder, [])
    byFolder.get(folder)!.push(en)
  }

  const folderGroups = [...byFolder.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
  for (const [, group] of folderGroups) {
    group.sort((a, b) => a.node.id.localeCompare(b.node.id))
  }

  const groupEffective: { nodes: EgoNode[]; nodesW: number; bgW: number }[] = []
  for (const [folder, group] of folderGroups) {
    let nodesW = 0
    for (let ni = 0; ni < group.length; ni++) {
      nodesW += w(group[ni].node.id)
      if (ni < group.length - 1) nodesW += NODE_GAP
    }
    const folderLabel = folder === '.' ? '(root)' : folder
    const labelW = measureFolderLabelWidth(folderLabel)
    const bgW = Math.max(labelW, nodesW + FOLDER_PAD * 2)
    groupEffective.push({ nodes: group, nodesW, bgW })
  }

  let totalWidth = 0
  for (let gi = 0; gi < groupEffective.length; gi++) {
    totalWidth += groupEffective[gi].bgW
    if (gi < groupEffective.length - 1) totalWidth += FOLDER_GROUP_GAP
  }

  let cursor = -totalWidth / 2
  for (let gi = 0; gi < groupEffective.length; gi++) {
    const { nodes: group, nodesW, bgW } = groupEffective[gi]
    const nodesStart = cursor + (bgW - nodesW) / 2
    let nodeCursor = nodesStart
    for (let ni = 0; ni < group.length; ni++) {
      const nw = w(group[ni].node.id)
      positions.set(group[ni].node.id, {
        x: nodeCursor + nw / 2,
        y: rowY,
      })
      nodeCursor += nw
      if (ni < group.length - 1) nodeCursor += NODE_GAP
    }
    cursor += bgW
    if (gi < groupEffective.length - 1) cursor += FOLDER_GROUP_GAP
  }
}

interface LayoutMeta {
  positions: Map<string, { x: number; y: number }>
  /** Y where edges going UP should turn (midpoint of top gap) */
  turnYUp: number
  /** Y where edges going DOWN should turn (midpoint of bottom gap) */
  turnYDown: number
}

function layeredLayout(
  egoNodes: EgoNode[],
  centerId: string,
  nodeWidths: Map<string, number>,
): LayoutMeta {
  const positions = new Map<string, { x: number; y: number }>()
  if (egoNodes.length === 0) return { positions, turnYUp: -60, turnYDown: 60 }

  const w = (id: string) => nodeWidths.get(id) ?? NODE_MIN_WIDTH
  const centerNode = egoNodes.find((en) => en.node.id === centerId)
  if (!centerNode) return { positions, turnYUp: -60, turnYDown: 60 }

  const selectedName = centerNode.node.label

  // === Center row (depth 0): vertical columns left/right of selected ===
  positions.set(centerId, { x: 0, y: 0 })
  const sw = w(centerId)

  // Same-folder imports → left column, right-aligned, vertically centered
  const sameImports = egoNodes
    .filter((en) => en.depth === 0 && en.relation === 'import')
    .sort((a, b) => {
      const pa = commonPrefixLength(a.node.label, selectedName)
      const pb = commonPrefixLength(b.node.label, selectedName)
      if (pa !== pb) return pb - pa
      return a.node.label.localeCompare(b.node.label)
    })

  // Right edge of left column: fixed distance from selected's left edge
  const leftRightEdge = -(sw / 2 + SIDE_GAP)

  if (sameImports.length > 0) {
    const stackH = sameImports.length * NODE_HEIGHT + (sameImports.length - 1) * STACK_V_GAP
    const startY = -(stackH - NODE_HEIGHT) / 2
    for (let i = 0; i < sameImports.length; i++) {
      const en = sameImports[i]
      const nw = w(en.node.id)
      // Right-align: right edge of every node sits at leftRightEdge
      positions.set(en.node.id, {
        x: leftRightEdge - nw / 2,
        y: startY + i * (NODE_HEIGHT + STACK_V_GAP),
      })
    }
  }

  // Same-folder imported-by → right column, left-aligned, vertically centered
  const sameImportedBy = egoNodes
    .filter((en) => en.depth === 0 && en.relation === 'imported-by')
    .sort((a, b) => {
      const pa = commonPrefixLength(a.node.label, selectedName)
      const pb = commonPrefixLength(b.node.label, selectedName)
      if (pa !== pb) return pb - pa
      return a.node.label.localeCompare(b.node.label)
    })

  // Left edge of right column: fixed distance from selected's right edge
  const rightLeftEdge = sw / 2 + SIDE_GAP

  if (sameImportedBy.length > 0) {
    const stackH = sameImportedBy.length * NODE_HEIGHT + (sameImportedBy.length - 1) * STACK_V_GAP
    const startY = -(stackH - NODE_HEIGHT) / 2
    for (let i = 0; i < sameImportedBy.length; i++) {
      const en = sameImportedBy[i]
      const nw = w(en.node.id)
      // Left-align: left edge of every node sits at rightLeftEdge
      positions.set(en.node.id, {
        x: rightLeftEdge + nw / 2,
        y: startY + i * (NODE_HEIGHT + STACK_V_GAP),
      })
    }
  }

  // Siblings → right column below imported-by (or centered if no imported-by)
  const siblings = egoNodes
    .filter((en) => en.depth === 0 && en.relation === 'sibling')
    .sort((a, b) => a.node.label.localeCompare(b.node.label))

  if (siblings.length > 0) {
    let sibStartY: number
    if (sameImportedBy.length > 0) {
      const impStackH = sameImportedBy.length * NODE_HEIGHT + (sameImportedBy.length - 1) * STACK_V_GAP
      const impStartY = -(impStackH - NODE_HEIGHT) / 2
      sibStartY = impStartY + sameImportedBy.length * (NODE_HEIGHT + STACK_V_GAP) + SIBLING_GAP
    } else {
      const sibStackH = siblings.length * NODE_HEIGHT + (siblings.length - 1) * STACK_V_GAP
      sibStartY = -(sibStackH - NODE_HEIGHT) / 2
    }
    for (let i = 0; i < siblings.length; i++) {
      const en = siblings[i]
      const nw = w(en.node.id)
      positions.set(en.node.id, {
        x: rightLeftEdge + nw / 2,
        y: sibStartY + i * (NODE_HEIGHT + STACK_V_GAP),
      })
    }
  }

  // === Compute center row extent for dynamic top/bottom placement ===
  let centerMinY = 0
  let centerMaxY = 0
  for (const en of egoNodes) {
    if (en.depth !== 0) continue
    const pos = positions.get(en.node.id)
    if (pos) {
      centerMinY = Math.min(centerMinY, pos.y - NODE_HEIGHT / 2)
      centerMaxY = Math.max(centerMaxY, pos.y + NODE_HEIGHT / 2)
    }
  }

  // Center background edges (with padding + label)
  const centerBgTop = centerMinY - FOLDER_PAD - FOLDER_LABEL_H
  const centerBgBottom = centerMaxY + FOLDER_PAD

  // Ensure top/bottom rows don't overlap center background.
  // Top row: its bg bottom = topRowY + NODE_HEIGHT/2 + FOLDER_PAD must be above centerBgTop - ROW_GAP
  const topRowY = Math.min(
    -MIN_ROW_SPACING,
    centerBgTop - ROW_GAP - NODE_HEIGHT / 2 - FOLDER_PAD,
  )
  // Bottom row: its bg top = bottomRowY - NODE_HEIGHT/2 - FOLDER_PAD - FOLDER_LABEL_H must be below centerBgBottom + ROW_GAP
  const bottomRowY = Math.max(
    MIN_ROW_SPACING,
    centerBgBottom + ROW_GAP + NODE_HEIGHT / 2 + FOLDER_PAD + FOLDER_LABEL_H,
  )

  // === Top (depth -1) and bottom (depth 1) rows: folder-grouped layout ===
  const topRow = egoNodes.filter((en) => en.depth === -1)
  if (topRow.length > 0) layoutFolderRow(topRow, topRowY, nodeWidths, positions)

  const bottomRow = egoNodes.filter((en) => en.depth === 1)
  if (bottomRow.length > 0) layoutFolderRow(bottomRow, bottomRowY, nodeWidths, positions)

  // Compute turn points: midpoint of gap between center bg and top/bottom bg
  const topBgBottom = topRowY + NODE_HEIGHT / 2 + FOLDER_PAD
  const bottomBgTop = bottomRowY - NODE_HEIGHT / 2 - FOLDER_PAD - FOLDER_LABEL_H
  const turnYUp = (centerBgTop + topBgBottom) / 2
  const turnYDown = (centerBgBottom + bottomBgTop) / 2

  return { positions, turnYUp, turnYDown }
}

// ---------------------------------------------------------------------------
// Pick handle pair
// ---------------------------------------------------------------------------

function pickHandles(
  srcPos: { x: number; y: number },
  tgtPos: { x: number; y: number },
): { sourceHandle: string; targetHandle: string } {
  const dx = tgtPos.x - srcPos.x
  const dy = tgtPos.y - srcPos.y

  if (Math.abs(dy) > NODE_HEIGHT) {
    return dy > 0
      ? { sourceHandle: 's-bottom', targetHandle: 't-top' }
      : { sourceHandle: 's-top', targetHandle: 't-bottom' }
  }

  return dx > 0
    ? { sourceHandle: 's-right', targetHandle: 't-left' }
    : { sourceHandle: 's-left', targetHandle: 't-right' }
}

// ---------------------------------------------------------------------------
// Build folder background nodes
// ---------------------------------------------------------------------------

function buildFolderBackgrounds(
  egoNodes: EgoNode[],
  positions: Map<string, { x: number; y: number }>,
  nodeWidths: Map<string, number>,
): Node[] {
  const key = (depth: number, folder: string) => `${depth}::${folder}`
  const groups = new Map<string, { folder: string; items: { pos: { x: number; y: number }; w: number }[] }>()

  for (const en of egoNodes) {
    const pos = positions.get(en.node.id)
    if (!pos) continue
    const folder = en.node.folder || '.'
    const k = key(en.depth, folder)
    const nw = nodeWidths.get(en.node.id) ?? NODE_MIN_WIDTH
    if (!groups.has(k)) groups.set(k, { folder, items: [] })
    groups.get(k)!.items.push({ pos, w: nw })
  }

  const bgNodes: Node[] = []
  for (const [k, { folder, items }] of groups) {
    if (items.length === 0) continue

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const { pos, w } of items) {
      minX = Math.min(minX, pos.x - w / 2)
      minY = Math.min(minY, pos.y - NODE_HEIGHT / 2)
      maxX = Math.max(maxX, pos.x + w / 2)
      maxY = Math.max(maxY, pos.y + NODE_HEIGHT / 2)
    }

    // Background width: must fit the nodes (with padding) and the label
    const nodesSpan = maxX - minX
    const folderLabel = folder === '.' ? '(root)' : folder
    const labelW = measureFolderLabelWidth(folderLabel)
    const bgW = Math.max(labelW, nodesSpan + FOLDER_PAD * 2)
    const height = maxY - minY + FOLDER_PAD * 2 + FOLDER_LABEL_H

    // Center the background around the nodes' center
    const nodesCenterX = (minX + maxX) / 2
    const bgX = nodesCenterX - bgW / 2

    bgNodes.push({
      id: `__folder__${k}`,
      type: 'folderBg',
      position: {
        x: bgX,
        y: minY - FOLDER_PAD - FOLDER_LABEL_H,
      },
      data: {
        folderLabel,
        width: bgW,
        height,
      } satisfies FolderBgData,
      selectable: false,
      draggable: false,
      connectable: false,
      focusable: false,
      zIndex: -1,
    })
  }

  return bgNodes
}

// ---------------------------------------------------------------------------
// Build ReactFlow nodes + edges
// ---------------------------------------------------------------------------

function buildGraphData(
  egoNodes: EgoNode[],
  egoEdges: GraphFileEdge[],
  layoutMeta: LayoutMeta,
  nodeWidths: Map<string, number>,
  selectedId: string,
): { nodes: Node[]; edges: Edge[] } {
  const { positions, turnYUp, turnYDown } = layoutMeta
  const folderBgNodes = buildFolderBackgrounds(egoNodes, positions, nodeWidths)

  const rfNodes: Node[] = egoNodes.map((en) => {
    const pos = positions.get(en.node.id) ?? { x: 0, y: 0 }
    const nw = nodeWidths.get(en.node.id) ?? NODE_MIN_WIDTH
    const borderColor = LANGUAGE_BORDER[en.node.language] ?? '#888'
    return {
      id: en.node.id,
      type: 'graphNode',
      position: { x: pos.x - nw / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: {
        folder: en.node.folder,
        filename: en.node.label,
        borderColor,
        isSelected: en.node.id === selectedId,
        isTestFile: en.node.isTestFile,
        isParseable: getConfigForFile(en.node.id) !== null,
        isImage: isImageFile(en.node.label),
        isSibling: en.relation === 'sibling',
        nodeWidth: nw,
      } satisfies GraphNodeData,
    }
  })

  // IDs of same-folder center-row nodes (depth 0, not self) — force side handles
  const centerRowIds = new Set(
    egoNodes
      .filter((en) => en.depth === 0 && en.relation !== 'self')
      .map((en) => en.node.id),
  )

  const rfEdges: Edge[] = egoEdges.map((e) => {
    const srcPos = positions.get(e.source) ?? { x: 0, y: 0 }
    const tgtPos = positions.get(e.target) ?? { x: 0, y: 0 }

    // Force left/right handles for center-row (same-folder) edges
    const otherId = e.source === selectedId ? e.target : e.source
    let handles: { sourceHandle: string; targetHandle: string }
    if (centerRowIds.has(otherId)) {
      const dx = tgtPos.x - srcPos.x
      handles = dx > 0
        ? { sourceHandle: 's-right', targetHandle: 't-left' }
        : { sourceHandle: 's-left', targetHandle: 't-right' }
    } else {
      handles = pickHandles(srcPos, tgtPos)
    }

    let stroke: string
    if (e.source === selectedId) {
      stroke = EDGE_COLOR_DEPENDENCY
    } else {
      stroke = EDGE_COLOR_DEPENDENT
    }

    // For cross-folder (vertical) edges, set turnY to the gap midpoint.
    // Use the *depth* of the other node, not dy, because imported-by edges
    // have source=bottomNode → target=selected (dy < 0 despite being bottom row).
    const isCrossFolder = !centerRowIds.has(otherId)
    let edgeData: { turnY?: number } | undefined
    if (isCrossFolder) {
      const otherDepth = egoNodes.find((en) => en.node.id === otherId)?.depth ?? 0
      edgeData = { turnY: otherDepth < 0 ? turnYUp : turnYDown }
    }

    return {
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      type: 'nearTarget',
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      data: edgeData,
      zIndex: -2,
      style: {
        stroke,
        strokeWidth: 2,
        strokeOpacity: 0.45,
      },
    }
  })

  return { nodes: [...folderBgNodes, ...rfNodes], edges: rfEdges }
}

// ---------------------------------------------------------------------------
// Derive selected graph node from canvas focus
// ---------------------------------------------------------------------------

function useCanvasFocusedFilePath(rootPath: string | null): string | null {
  const focusedNodeId = useCanvasStore((s) => s.focusedNodeId)
  const canvasNodes = useCanvasStore((s) => s.nodes)

  return useMemo(() => {
    if (!focusedNodeId || !rootPath) return null
    const node = canvasNodes.find((n) => n.id === focusedNodeId)
    if (!node) return null
    const absPath = (node.type === 'folder' || node.type === 'file')
      ? node.data.path
      : node.data.filePath
    if (!absPath) return null
    return toRepoRelative(absPath, rootPath)
  }, [focusedNodeId, canvasNodes, rootPath])
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function GraphFlow() {
  const rootPath = useBrowserStore((s) => s.rootPath)
  const scanState = useGraphStore((s) => s.scanState)
  const scannedCount = useGraphStore((s) => s.scannedCount)
  const errorMessage = useGraphStore((s) => s.errorMessage)
  const allNodes = useGraphStore((s) => s.allNodes)
  const allEdges = useGraphStore((s) => s.allEdges)
  const scan = useGraphStore((s) => s.scan)
  const [showTests, setShowTests] = useState(false)

  const lastScannedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!rootPath || rootPath === lastScannedRef.current) return
    lastScannedRef.current = rootPath
    void scan(rootPath)
  }, [rootPath, scan])

  const canvasFocusedPath = useCanvasFocusedFilePath(rootPath)

  const selectedNodeId = useMemo(() => {
    if (canvasFocusedPath && allNodes.some((n) => n.id === canvasFocusedPath)) {
      return canvasFocusedPath
    }
    if (allNodes.length > 0) {
      return allNodes.reduce((best, n) => n.score > best.score ? n : best, allNodes[0]).id
    }
    return null
  }, [canvasFocusedPath, allNodes])

  const { egoNodes, egoEdges } = useMemo(() => {
    if (!selectedNodeId || allNodes.length === 0) return { egoNodes: [] as EgoNode[], egoEdges: [] as GraphFileEdge[] }
    const result = directNeighbors(selectedNodeId, allNodes, allEdges, showTests)
    return { egoNodes: result.nodes, egoEdges: result.edges }
  }, [selectedNodeId, allNodes, allEdges, showTests])

  // Pre-compute widths so layout and rendering use the same values
  const nodeWidths = useMemo(
    () => computeNodeWidths(egoNodes, selectedNodeId ?? ''),
    [egoNodes, selectedNodeId],
  )

  const layoutMeta = useMemo(
    () => layeredLayout(egoNodes, selectedNodeId ?? '', nodeWidths),
    [egoNodes, selectedNodeId, nodeWidths],
  )

  const { nodes, edges } = useMemo(
    () => buildGraphData(egoNodes, egoEdges, layoutMeta, nodeWidths, selectedNodeId ?? ''),
    [egoNodes, egoEdges, layoutMeta, nodeWidths, selectedNodeId],
  )

  const focusFileByPath = useCanvasStore((s) => s.focusFileByPath)
  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.type === 'folderBg') return
    void focusFileByPath(node.id)
  }, [focusFileByPath])

  if (scanState === 'idle' || !rootPath) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No project open
      </div>
    )
  }

  if (scanState === 'error') {
    return (
      <div className="flex items-center justify-center h-full text-sm text-red-400">
        Graph build failed: {errorMessage}
      </div>
    )
  }

  const showOverlay = scanState === 'scanning' || (scanState === 'ready' && allNodes.length === 0)

  return (
    <div className="absolute inset-0">
      {scanState === 'ready' && egoNodes.length > 0 && (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          colorMode="dark"
          proOptions={proOptions}
          nodesDraggable={true}
          nodesConnectable={false}
          elementsSelectable={false}
          onNodeClick={onNodeClick}
          minZoom={0.05}
          maxZoom={2}
          fitView
          fitViewOptions={{ padding: 0.25 }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={2}
            color="var(--color-foreground)"
            style={{ opacity: 0.1 }}
          />
        </ReactFlow>
      )}

      {showOverlay && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-background/80">
          {scanState === 'scanning'
            ? `Scanning project... ${scannedCount} files`
            : 'No parseable source files found.'}
        </div>
      )}

      {scanState === 'ready' && egoNodes.length > 0 && (
        <div className="absolute bottom-3 left-3 flex items-center gap-2 pointer-events-auto">
          <div className="px-2.5 py-1.5 rounded-lg bg-background/80 backdrop-blur-sm border border-border text-[11px] text-muted-foreground font-mono flex items-center gap-3">
            <span>{egoNodes.length} files</span>
            <span className="flex items-center gap-1">
              <span style={{ display: 'inline-block', width: 12, height: 2, background: EDGE_COLOR_DEPENDENCY, borderRadius: 1 }} />
              imports
            </span>
            <span className="flex items-center gap-1">
              <span style={{ display: 'inline-block', width: 12, height: 2, background: EDGE_COLOR_DEPENDENT, borderRadius: 1 }} />
              imported by
            </span>
            <button
              onClick={() => setShowTests((v) => !v)}
              className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors"
              style={{ opacity: showTests ? 1 : 0.5 }}
            >
              <FlaskConical style={{ width: 12, height: 12, color: '#ca8a04' }} />
              tests {showTests ? 'on' : 'off'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Graph() {
  return (
    <ReactFlowProvider>
      <GraphFlow />
    </ReactFlowProvider>
  )
}
