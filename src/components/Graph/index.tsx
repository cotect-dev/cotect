import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  BaseEdge,
  Handle,
  Position,
  useReactFlow,
  type Node,
  type Edge,
  type EdgeProps,
  type NodeMouseHandler,
  type NodeProps,
  type Viewport as RFViewport,
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

const NODE_WIDTH = 180    // fixed width — matches Canvas file nodes
const NODE_HEIGHT = 56    // matches Canvas NODE_HEIGHT
const NODE_GAP = 4       // gap between adjacent nodes (top/bottom rows)
const SIDE_GAP = 100     // horizontal space between selected node edge and side column edge
const STACK_V_GAP = 2    // vertical gap between vertically stacked nodes

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

function measureNodeWidth(_label: string, _isSelected: boolean): number {
  return NODE_WIDTH
}

/** Minimum background width needed to fit the folder label without clipping. */
const FOLDER_LABEL_PAD = 24 // 12px left + 12px right inside the background
function measureFolderLabelWidth(label: string): number {
  const textW = measureTextWidth(label, '12px', '600')
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
  isSelected: boolean
  isTestFile: boolean
  isParseable: boolean
  isImage: boolean
  isSibling: boolean
  [key: string]: unknown
}

const GraphNodeComponent = memo(({ data }: NodeProps<Node<GraphNodeData>>) => {
  const d = data as GraphNodeData
  const Icon = d.isTestFile ? FlaskConical : d.isImage ? Image : d.isParseable ? FileCode : FileText
  const iconColor = d.isTestFile ? 'text-yellow-600' : d.isImage ? 'text-emerald-400' : d.isParseable ? 'text-blue-400' : 'text-muted-foreground'
  const borderClass = d.isTestFile ? 'border-yellow-700/40 border-dashed' : 'border-border'
  const focusRing = d.isSelected ? 'ring-2 ring-primary/40 border-primary/60' : ''

  return (
    <div
      className={`bg-background border rounded-lg px-3 py-2 w-[180px] max-w-[180px] cursor-pointer hover:border-primary/50 hover:bg-muted/50 ${borderClass} ${focusRing} ${d.isTestFile ? 'opacity-60' : d.isSibling ? 'opacity-45' : ''}`}
    >
      <Handle type="source" position={Position.Top} id="s-top" className="opacity-0" />
      <Handle type="source" position={Position.Right} id="s-right" className="opacity-0" />
      <Handle type="source" position={Position.Bottom} id="s-bottom" className="opacity-0" />
      <Handle type="source" position={Position.Left} id="s-left" className="opacity-0" />
      <Handle type="target" position={Position.Top} id="t-top" className="opacity-0" />
      <Handle type="target" position={Position.Right} id="t-right" className="opacity-0" />
      <Handle type="target" position={Position.Bottom} id="t-bottom" className="opacity-0" />
      <Handle type="target" position={Position.Left} id="t-left" className="opacity-0" />

      <div className="flex items-center gap-2 min-w-0 overflow-hidden">
        <Icon className={`h-4 w-4 shrink-0 ${iconColor}`} />
        <span className="text-sm font-medium text-foreground truncate min-w-0">{d.filename}</span>
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
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--color-muted-foreground)',
          opacity: 0.85,
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

const MIN_ROW_SPACING = 60  // minimum center-to-row distance
const ROW_GAP = 30          // minimum visual gap between folder backgrounds
const FOLDER_GROUP_GAP = 15
const SIBLING_GAP = 8       // extra gap before siblings in the center row

// Y-step between sub-rows when a folder row wraps into multiple visual rows.
// = folder-bg height (NODE_HEIGHT + 2*FOLDER_PAD + FOLDER_LABEL_H) + ROW_GAP
const SUB_ROW_STEP = NODE_HEIGHT + 2 * FOLDER_PAD + FOLDER_LABEL_H + ROW_GAP

type FolderGroupInfo = { nodes: EgoNode[]; nodesW: number; bgW: number }

/** Total pixel width of a set of folder groups laid out in a single row. */
function folderRowWidth(groups: FolderGroupInfo[]): number {
  let w = 0
  for (let i = 0; i < groups.length; i++) {
    w += groups[i].bgW
    if (i < groups.length - 1) w += FOLDER_GROUP_GAP
  }
  return w
}

/**
 * Distribute folder groups into `numRows` contiguous visual rows by
 * finding the partition that minimises the maximum row width (optimal
 * linear partition).  This avoids the greedy pitfall where a single
 * wide group causes an early break, leaving it alone on a row while
 * related groups that should sit beside it end up in a separate row.
 *
 * The number of groups is always small (≤ ~12) so enumerating all
 * C(n-1, k-1) split-point combinations is trivially fast.
 */
function distributeFolderGroups(
  groups: FolderGroupInfo[],
  numRows: number,
): FolderGroupInfo[][] {
  const n = groups.length
  if (numRows <= 1 || n <= 1) return [groups.slice()]
  if (numRows >= n) return groups.map((g) => [g])

  /** Width of the contiguous slice groups[start..end). */
  function sliceWidth(start: number, end: number): number {
    let w = 0
    for (let i = start; i < end; i++) {
      w += groups[i].bgW
      if (i < end - 1) w += FOLDER_GROUP_GAP
    }
    return w
  }

  let bestMaxW = Infinity
  let bestMinW = -1 // tiebreaker: among same maxW, prefer most balanced rows
  let bestSplits: number[] = []

  /** Enumerate all ways to place (numRows - 1) split points in [1, n). */
  function enumerate(
    splits: number[],
    depth: number,
    minPos: number,
  ): void {
    if (depth === numRows - 1) {
      const all = [0, ...splits, n]
      let maxW = 0
      let minW = Infinity
      for (let r = 0; r < numRows; r++) {
        const rw = sliceWidth(all[r], all[r + 1])
        maxW = Math.max(maxW, rw)
        minW = Math.min(minW, rw)
      }
      if (maxW < bestMaxW || (maxW === bestMaxW && minW > bestMinW)) {
        bestMaxW = maxW
        bestMinW = minW
        bestSplits = splits.slice()
      }
      return
    }
    const maxPos = n - (numRows - 1 - depth)
    for (let pos = minPos; pos <= maxPos; pos++) {
      splits.push(pos)
      enumerate(splits, depth + 1, pos + 1)
      splits.pop()
    }
  }

  enumerate([], 0, 1)

  const all = [0, ...bestSplits, n]
  return Array.from({ length: numRows }, (_, r) =>
    groups.slice(all[r], all[r + 1]),
  )
}

/**
 * Layout folder-grouped nodes in one or more visual rows, automatically
 * wrapping into a roughly rectangular shape when there are many groups.
 *
 * @param direction  +1 to stack additional rows downward (bottom row),
 *                   -1 to stack additional rows upward (top row).
 */
function layoutFolderRow(
  row: EgoNode[],
  rowY: number,
  nodeWidths: Map<string, number>,
  positions: Map<string, { x: number; y: number }>,
  direction: 1 | -1 = 1,
): void {
  const w = (id: string) => nodeWidths.get(id) ?? NODE_WIDTH

  // ---- Group nodes by folder ----
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

  // ---- Compute effective widths for each folder group ----
  const groupInfos: FolderGroupInfo[] = []
  for (const [folder, group] of folderGroups) {
    let nodesW = 0
    for (let ni = 0; ni < group.length; ni++) {
      nodesW += w(group[ni].node.id)
      if (ni < group.length - 1) nodesW += NODE_GAP
    }
    const folderLabel = folder === '.' ? '(root)' : folder
    const labelW = measureFolderLabelWidth(folderLabel)
    const bgW = Math.max(labelW, nodesW + FOLDER_PAD * 2)
    groupInfos.push({ nodes: group, nodesW, bgW })
  }

  // ---- Find the optimal number of visual rows ----
  // Try 1..min(count, 5) rows, pick the aspect ratio closest to a
  // pleasant wide rectangle (TARGET_ASPECT ≈ 3:1).  A wider target
  // favors fewer rows, avoiding unnecessary vertical stacking that
  // forces edges to thread through intermediate sub-rows.
  const TARGET_ASPECT = 3.0
  const singleBgH = NODE_HEIGHT + 2 * FOLDER_PAD + FOLDER_LABEL_H
  const maxRows = Math.min(groupInfos.length, 5)

  let bestLayout: FolderGroupInfo[][] = [groupInfos]
  let bestScore = Infinity

  for (let nr = 1; nr <= maxRows; nr++) {
    const layout = distributeFolderGroups(groupInfos, nr)
    const maxW = Math.max(...layout.map(folderRowWidth))
    const totalH =
      layout.length * singleBgH + Math.max(0, layout.length - 1) * ROW_GAP
    const aspect = maxW / totalH
    const score = Math.abs(Math.log(aspect / TARGET_ASPECT))

    if (score < bestScore) {
      bestScore = score
      bestLayout = layout
    }
  }

  // ---- Reorder sub-rows: widest last ----
  // The last sub-row is centered (no trunk avoidance needed) while earlier
  // sub-rows are split left/right.  Putting the widest sub-row last lets
  // it benefit from clean centered placement instead of being awkwardly
  // split, and the narrower rows are easier to partition around the trunk.
  if (bestLayout.length > 1) {
    let widestIdx = 0
    let widestW = -1
    for (let ri = 0; ri < bestLayout.length; ri++) {
      const rw = folderRowWidth(bestLayout[ri])
      if (rw > widestW) { widestW = rw; widestIdx = ri }
    }
    if (widestIdx !== bestLayout.length - 1) {
      const widest = bestLayout.splice(widestIdx, 1)[0]
      bestLayout.push(widest)
    }
  }

  // ---- Position nodes within each visual sub-row ----
  // When there are multiple sub-rows, edges from the selected node travel
  // vertically at x=0 and pass through intermediate sub-rows.  Non-last
  // sub-rows are split into left/right halves straddling x=0 (balanced by
  // total width) so no folder background covers the trunk line.
  const lastSubRowIdx = bestLayout.length - 1
  const TRUNK_HALF_GAP = FOLDER_GROUP_GAP / 2

  /** Place a list of folder groups left-to-right starting at `startX`. */
  const placeGroups = (
    groups: FolderGroupInfo[],
    startX: number,
    y: number,
  ) => {
    let cursor = startX
    for (const g of groups) {
      const nodesStart = cursor + (g.bgW - g.nodesW) / 2
      let nodeCursor = nodesStart
      for (let ni = 0; ni < g.nodes.length; ni++) {
        const nw = w(g.nodes[ni].node.id)
        positions.set(g.nodes[ni].node.id, { x: nodeCursor + nw / 2, y })
        nodeCursor += nw
        if (ni < g.nodes.length - 1) nodeCursor += NODE_GAP
      }
      cursor += g.bgW + FOLDER_GROUP_GAP
    }
  }

  for (let ri = 0; ri < bestLayout.length; ri++) {
    const subRow = bestLayout[ri]
    const subRowY = rowY + direction * ri * SUB_ROW_STEP
    const totalW = folderRowWidth(subRow)

    const needAvoidance = bestLayout.length > 1 && ri < lastSubRowIdx

    if (needAvoidance && subRow.length > 1) {
      // Balanced partition: try all 2^n subsets (n is small), pick the
      // one that minimises |leftWidth − rightWidth|.  On ties prefer the
      // highest mask so later (alphabetically) groups land on the right,
      // giving a natural left-to-right reading order.
      const n = subRow.length
      let bestMask = 1
      let bestDiff = Infinity

      for (let mask = 1; mask < (1 << n) - 1; mask++) {
        let lw = 0, rw = 0, lc = 0, rc = 0
        for (let gi = 0; gi < n; gi++) {
          if (mask & (1 << gi)) { rw += subRow[gi].bgW; rc++ }
          else { lw += subRow[gi].bgW; lc++ }
        }
        lw += Math.max(0, lc - 1) * FOLDER_GROUP_GAP
        rw += Math.max(0, rc - 1) * FOLDER_GROUP_GAP
        const diff = Math.abs(lw - rw)
        if (diff < bestDiff || (diff === bestDiff && mask > bestMask)) {
          bestDiff = diff; bestMask = mask
        }
      }

      const leftGroups: FolderGroupInfo[] = []
      const rightGroups: FolderGroupInfo[] = []
      for (let gi = 0; gi < n; gi++) {
        if (bestMask & (1 << gi)) rightGroups.push(subRow[gi])
        else leftGroups.push(subRow[gi])
      }

      const leftW = folderRowWidth(leftGroups)
      placeGroups(leftGroups, -TRUNK_HALF_GAP - leftW, subRowY)
      placeGroups(rightGroups, TRUNK_HALF_GAP, subRowY)
    } else if (needAvoidance && subRow.length === 1) {
      // Single group: place entirely to the right of the trunk
      placeGroups(subRow, TRUNK_HALF_GAP, subRowY)
    } else {
      // Centered (single sub-row or last sub-row)
      placeGroups(subRow, -totalW / 2, subRowY)
    }
  }
}

interface LayoutMeta {
  positions: Map<string, { x: number; y: number }>
}

function layeredLayout(
  egoNodes: EgoNode[],
  centerId: string,
  nodeWidths: Map<string, number>,
): LayoutMeta {
  const positions = new Map<string, { x: number; y: number }>()
  if (egoNodes.length === 0) return { positions }

  const w = (id: string) => nodeWidths.get(id) ?? NODE_WIDTH
  const centerNode = egoNodes.find((en) => en.node.id === centerId)
  if (!centerNode) return { positions }

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

  // Siblings → split across left and right columns to equalise heights
  const siblings = egoNodes
    .filter((en) => en.depth === 0 && en.relation === 'sibling')
    .sort((a, b) => a.node.label.localeCompare(b.node.label))

  if (siblings.length > 0) {
    // Decide how many go on each side to balance total column heights
    const leftBaseCount = sameImports.length
    const rightBaseCount = sameImportedBy.length
    const idealLeftSibs = Math.round(
      (rightBaseCount - leftBaseCount + siblings.length) / 2,
    )
    const leftSibCount = Math.max(0, Math.min(siblings.length, idealLeftSibs))

    const leftSibs = siblings.slice(0, leftSibCount)
    const rightSibs = siblings.slice(leftSibCount)

    // Left siblings: below same-folder imports, right-aligned
    if (leftSibs.length > 0) {
      let sibStartY: number
      if (sameImports.length > 0) {
        const impStackH = sameImports.length * NODE_HEIGHT + (sameImports.length - 1) * STACK_V_GAP
        const impStartY = -(impStackH - NODE_HEIGHT) / 2
        sibStartY = impStartY + sameImports.length * (NODE_HEIGHT + STACK_V_GAP) + SIBLING_GAP
      } else {
        const sibStackH = leftSibs.length * NODE_HEIGHT + (leftSibs.length - 1) * STACK_V_GAP
        sibStartY = -(sibStackH - NODE_HEIGHT) / 2
      }
      for (let i = 0; i < leftSibs.length; i++) {
        const en = leftSibs[i]
        const nw = w(en.node.id)
        positions.set(en.node.id, {
          x: leftRightEdge - nw / 2,
          y: sibStartY + i * (NODE_HEIGHT + STACK_V_GAP),
        })
      }
    }

    // Right siblings: below same-folder imported-by, left-aligned
    if (rightSibs.length > 0) {
      let sibStartY: number
      if (sameImportedBy.length > 0) {
        const impStackH = sameImportedBy.length * NODE_HEIGHT + (sameImportedBy.length - 1) * STACK_V_GAP
        const impStartY = -(impStackH - NODE_HEIGHT) / 2
        sibStartY = impStartY + sameImportedBy.length * (NODE_HEIGHT + STACK_V_GAP) + SIBLING_GAP
      } else {
        const sibStackH = rightSibs.length * NODE_HEIGHT + (rightSibs.length - 1) * STACK_V_GAP
        sibStartY = -(sibStackH - NODE_HEIGHT) / 2
      }
      for (let i = 0; i < rightSibs.length; i++) {
        const en = rightSibs[i]
        const nw = w(en.node.id)
        positions.set(en.node.id, {
          x: rightLeftEdge + nw / 2,
          y: sibStartY + i * (NODE_HEIGHT + STACK_V_GAP),
        })
      }
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
  if (topRow.length > 0) layoutFolderRow(topRow, topRowY, nodeWidths, positions, -1)

  const bottomRow = egoNodes.filter((en) => en.depth === 1)
  if (bottomRow.length > 0) layoutFolderRow(bottomRow, bottomRowY, nodeWidths, positions, 1)

  return { positions }
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
    const nw = nodeWidths.get(en.node.id) ?? NODE_WIDTH
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
  const { positions } = layoutMeta
  const folderBgNodes = buildFolderBackgrounds(egoNodes, positions, nodeWidths)

  const rfNodes: Node[] = egoNodes.map((en) => {
    const pos = positions.get(en.node.id) ?? { x: 0, y: 0 }
    const nw = nodeWidths.get(en.node.id) ?? NODE_WIDTH
    return {
      id: en.node.id,
      type: 'graphNode',
      position: { x: pos.x - nw / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: {
        folder: en.node.folder,
        filename: en.node.label,
        isSelected: en.node.id === selectedId,
        isTestFile: en.node.isTestFile,
        isParseable: getConfigForFile(en.node.id) !== null,
        isImage: isImageFile(en.node.label),
        isSibling: en.relation === 'sibling',
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

    // For cross-folder (vertical) edges, compute turnY per-edge so it sits
    // in the gap directly above/below the target's sub-row.  This prevents
    // edges to farther sub-rows from routing their horizontal segment through
    // a closer sub-row's nodes.
    const isCrossFolder = !centerRowIds.has(otherId)
    let edgeData: { turnY?: number } | undefined
    if (isCrossFolder) {
      const otherPos = positions.get(otherId)
      const otherDepth = egoNodes.find((en) => en.node.id === otherId)?.depth ?? 0
      if (otherPos) {
        const edgeTurnY = otherDepth < 0
          // Top row: turn in the gap just below the target's folder background
          ? otherPos.y + NODE_HEIGHT / 2 + FOLDER_PAD + ROW_GAP / 2
          // Bottom row: turn in the gap just above the target's folder background
          : otherPos.y - NODE_HEIGHT / 2 - FOLDER_PAD - FOLDER_LABEL_H - ROW_GAP / 2
        edgeData = { turnY: edgeTurnY }
      }
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

  const reactFlow = useReactFlow()

  // Translate wheel into viewport pan (same as Canvas / view 1)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation()
    const viewport = reactFlow.getViewport()
    void reactFlow.setViewport(
      { x: viewport.x - e.deltaX, y: viewport.y - e.deltaY, zoom: viewport.zoom },
      { duration: 0 },
    )
  }, [reactFlow])

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
        <div className="absolute inset-0" onWheel={handleWheel}>
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
            zoomOnScroll={false}
            zoomOnDoubleClick={false}
            zoomOnPinch={false}
            minZoom={1}
            maxZoom={1}
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
        </div>
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
