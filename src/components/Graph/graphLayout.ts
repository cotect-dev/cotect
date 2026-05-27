import { Position } from '@xyflow/react'
import type { GraphFileNode, GraphFileEdge } from '@/store/graph'
import { NODE_WIDTH, NODE_HEIGHT } from '@/lib/canvasGeometry'

export { NODE_WIDTH, NODE_HEIGHT }
const NODE_GAP = 4
const SIDE_GAP = 100
const STACK_V_GAP = 2

export const FOLDER_PAD = 16
export const FOLDER_LABEL_H = 22

const MIN_ROW_SPACING = 60
export const ROW_GAP = 30
const FOLDER_GROUP_GAP = 15
const SIBLING_GAP = 8

const SUB_ROW_STEP = NODE_HEIGHT + 2 * FOLDER_PAD + FOLDER_LABEL_H + ROW_GAP

const STEP_OFFSET = 20
const CORNER_R = 8

export const EDGE_COLOR_DEPENDENCY = '#4ade80'
export const EDGE_COLOR_DEPENDENT = '#a78bfa'

export type EgoRelation = 'import' | 'self' | 'imported-by' | 'sibling'

export interface EgoNode {
  node: GraphFileNode
  depth: number
  relation: EgoRelation
}

let _measureEl: HTMLSpanElement | null = null
function getMeasureEl(): HTMLSpanElement {
  if (!_measureEl) {
    const el = document.createElement('span')
    el.style.cssText =
      'position:absolute;visibility:hidden;height:auto;width:auto;white-space:nowrap;' +
      'font-size:11px;line-height:16px;pointer-events:none;'
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

const FOLDER_LABEL_PAD = 24
function measureFolderLabelWidth(label: string): number {
  return Math.ceil(measureTextWidth(label, '12px', '600') + FOLDER_LABEL_PAD)
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

function sortByPrefixSimilarity(nodes: EgoNode[], selectedName: string): EgoNode[] {
  return [...nodes].sort((a, b) => {
    const pa = commonPrefixLength(a.node.label, selectedName)
    const pb = commonPrefixLength(b.node.label, selectedName)
    if (pa !== pb) return pb - pa
    return a.node.label.localeCompare(b.node.label)
  })
}

export function nearTargetPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  sourcePos: Position,
  targetPos: Position,
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
    const turnX = (sx + tx) / 2
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

export function directNeighbors(
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

  const imports = new Set<string>()
  const importedBy = new Set<string>()

  for (const e of allEdges) {
    if (e.source === startId && canInclude(e.target) && e.target !== startId) {
      imports.add(e.target)
    }
  }
  for (const e of allEdges) {
    if (
      e.target === startId &&
      canInclude(e.source) &&
      e.source !== startId &&
      !imports.has(e.source)
    ) {
      importedBy.add(e.source)
    }
  }

  const result: EgoNode[] = [{ node: startNode, depth: 0, relation: 'self' }]

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

  for (const n of allNodes) {
    if (n.id === startId) continue
    if ((n.folder || '.') !== centerFolder) continue
    if (imports.has(n.id) || importedBy.has(n.id)) continue
    if (!showTests && n.isTestFile) continue
    result.push({ node: n, depth: 0, relation: 'sibling' })
  }

  const visibleIds = new Set(result.map((en) => en.node.id))
  const edges = allEdges.filter(
    (e) =>
      (e.source === startId || e.target === startId) &&
      visibleIds.has(e.source) &&
      visibleIds.has(e.target),
  )

  return { nodes: result, edges }
}

export interface LayoutMeta {
  positions: Map<string, { x: number; y: number }>
}

type FolderGroupInfo = { nodes: EgoNode[]; nodesW: number; bgW: number }

function folderRowWidth(groups: FolderGroupInfo[]): number {
  let w = 0
  for (let i = 0; i < groups.length; i++) {
    w += groups[i].bgW
    if (i < groups.length - 1) w += FOLDER_GROUP_GAP
  }
  return w
}

function distributeFolderGroups(groups: FolderGroupInfo[], numRows: number): FolderGroupInfo[][] {
  const n = groups.length
  if (numRows <= 1 || n <= 1) return [groups.slice()]
  if (numRows >= n) return groups.map((g) => [g])

  function sliceWidth(start: number, end: number): number {
    let w = 0
    for (let i = start; i < end; i++) {
      w += groups[i].bgW
      if (i < end - 1) w += FOLDER_GROUP_GAP
    }
    return w
  }

  let bestMaxW = Infinity
  let bestMinW = -1
  let bestSplits: number[] = []

  function enumerate(splits: number[], depth: number, minPos: number): void {
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
  return Array.from({ length: numRows }, (_, r) => groups.slice(all[r], all[r + 1]))
}

function layoutFolderRow(
  row: EgoNode[],
  rowY: number,
  positions: Map<string, { x: number; y: number }>,
  direction: 1 | -1 = 1,
): void {
  const byFolder = new Map<string, EgoNode[]>()
  for (const en of row) {
    const folder = en.node.folder || '.'
    if (!byFolder.has(folder)) byFolder.set(folder, [])
    byFolder.get(folder)!.push(en)
  }

  const folderGroups = [...byFolder.entries()].sort(([a], [b]) => a.localeCompare(b))
  for (const [, group] of folderGroups) {
    group.sort((a, b) => a.node.id.localeCompare(b.node.id))
  }

  const groupInfos: FolderGroupInfo[] = []
  for (const [folder, group] of folderGroups) {
    let nodesW = 0
    for (let ni = 0; ni < group.length; ni++) {
      nodesW += NODE_WIDTH
      if (ni < group.length - 1) nodesW += NODE_GAP
    }
    const folderLabel = folder === '.' ? '(root)' : folder
    const labelW = measureFolderLabelWidth(folderLabel)
    const bgW = Math.max(labelW, nodesW + FOLDER_PAD * 2)
    groupInfos.push({ nodes: group, nodesW, bgW })
  }

  const TARGET_ASPECT = 3.0
  const singleBgH = NODE_HEIGHT + 2 * FOLDER_PAD + FOLDER_LABEL_H
  const maxRows = Math.min(groupInfos.length, 5)

  let bestLayout: FolderGroupInfo[][] = [groupInfos]
  let bestScore = Infinity

  for (let nr = 1; nr <= maxRows; nr++) {
    const layout = distributeFolderGroups(groupInfos, nr)
    const maxW = Math.max(...layout.map(folderRowWidth))
    const totalH = layout.length * singleBgH + Math.max(0, layout.length - 1) * ROW_GAP
    const aspect = maxW / totalH
    const score = Math.abs(Math.log(aspect / TARGET_ASPECT))
    if (score < bestScore) {
      bestScore = score
      bestLayout = layout
    }
  }

  if (bestLayout.length > 1) {
    let widestIdx = 0
    let widestW = -1
    for (let ri = 0; ri < bestLayout.length; ri++) {
      const rw = folderRowWidth(bestLayout[ri])
      if (rw > widestW) {
        widestW = rw
        widestIdx = ri
      }
    }
    if (widestIdx !== bestLayout.length - 1) {
      const widest = bestLayout.splice(widestIdx, 1)[0]
      bestLayout.push(widest)
    }
  }

  const lastSubRowIdx = bestLayout.length - 1
  const TRUNK_HALF_GAP = FOLDER_GROUP_GAP / 2

  const placeGroups = (groups: FolderGroupInfo[], startX: number, y: number) => {
    let cursor = startX
    for (const g of groups) {
      const nodesStart = cursor + (g.bgW - g.nodesW) / 2
      let nodeCursor = nodesStart
      for (let ni = 0; ni < g.nodes.length; ni++) {
        positions.set(g.nodes[ni].node.id, { x: nodeCursor + NODE_WIDTH / 2, y })
        nodeCursor += NODE_WIDTH
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
      const n = subRow.length
      let bestMask = 1
      let bestDiff = Infinity

      for (let mask = 1; mask < (1 << n) - 1; mask++) {
        let lw = 0,
          rw = 0,
          lc = 0,
          rc = 0
        for (let gi = 0; gi < n; gi++) {
          if (mask & (1 << gi)) {
            rw += subRow[gi].bgW
            rc++
          } else {
            lw += subRow[gi].bgW
            lc++
          }
        }
        lw += Math.max(0, lc - 1) * FOLDER_GROUP_GAP
        rw += Math.max(0, rc - 1) * FOLDER_GROUP_GAP
        const diff = Math.abs(lw - rw)
        if (diff < bestDiff || (diff === bestDiff && mask > bestMask)) {
          bestDiff = diff
          bestMask = mask
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
      placeGroups(subRow, TRUNK_HALF_GAP, subRowY)
    } else {
      placeGroups(subRow, -totalW / 2, subRowY)
    }
  }
}

export function layeredLayout(egoNodes: EgoNode[], centerId: string): LayoutMeta {
  const positions = new Map<string, { x: number; y: number }>()
  if (egoNodes.length === 0) return { positions }

  const centerNode = egoNodes.find((en) => en.node.id === centerId)
  if (!centerNode) return { positions }

  const selectedName = centerNode.node.label
  positions.set(centerId, { x: 0, y: 0 })
  const sw = NODE_WIDTH

  const sameImports = sortByPrefixSimilarity(
    egoNodes.filter((en) => en.depth === 0 && en.relation === 'import'),
    selectedName,
  )

  const leftRightEdge = -(sw / 2 + SIDE_GAP)

  if (sameImports.length > 0) {
    const stackH = sameImports.length * NODE_HEIGHT + (sameImports.length - 1) * STACK_V_GAP
    const startY = -(stackH - NODE_HEIGHT) / 2
    for (let i = 0; i < sameImports.length; i++) {
      positions.set(sameImports[i].node.id, {
        x: leftRightEdge - NODE_WIDTH / 2,
        y: startY + i * (NODE_HEIGHT + STACK_V_GAP),
      })
    }
  }

  const sameImportedBy = sortByPrefixSimilarity(
    egoNodes.filter((en) => en.depth === 0 && en.relation === 'imported-by'),
    selectedName,
  )

  const rightLeftEdge = sw / 2 + SIDE_GAP

  if (sameImportedBy.length > 0) {
    const stackH = sameImportedBy.length * NODE_HEIGHT + (sameImportedBy.length - 1) * STACK_V_GAP
    const startY = -(stackH - NODE_HEIGHT) / 2
    for (let i = 0; i < sameImportedBy.length; i++) {
      positions.set(sameImportedBy[i].node.id, {
        x: rightLeftEdge + NODE_WIDTH / 2,
        y: startY + i * (NODE_HEIGHT + STACK_V_GAP),
      })
    }
  }

  const siblings = egoNodes
    .filter((en) => en.depth === 0 && en.relation === 'sibling')
    .sort((a, b) => a.node.label.localeCompare(b.node.label))

  if (siblings.length > 0) {
    const leftBaseCount = sameImports.length
    const rightBaseCount = sameImportedBy.length
    const idealLeftSibs = Math.round((rightBaseCount - leftBaseCount + siblings.length) / 2)
    const leftSibCount = Math.max(0, Math.min(siblings.length, idealLeftSibs))

    const leftSibs = siblings.slice(0, leftSibCount)
    const rightSibs = siblings.slice(leftSibCount)

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
        positions.set(leftSibs[i].node.id, {
          x: leftRightEdge - NODE_WIDTH / 2,
          y: sibStartY + i * (NODE_HEIGHT + STACK_V_GAP),
        })
      }
    }

    if (rightSibs.length > 0) {
      let sibStartY: number
      if (sameImportedBy.length > 0) {
        const impStackH =
          sameImportedBy.length * NODE_HEIGHT + (sameImportedBy.length - 1) * STACK_V_GAP
        const impStartY = -(impStackH - NODE_HEIGHT) / 2
        sibStartY = impStartY + sameImportedBy.length * (NODE_HEIGHT + STACK_V_GAP) + SIBLING_GAP
      } else {
        const sibStackH = rightSibs.length * NODE_HEIGHT + (rightSibs.length - 1) * STACK_V_GAP
        sibStartY = -(sibStackH - NODE_HEIGHT) / 2
      }
      for (let i = 0; i < rightSibs.length; i++) {
        positions.set(rightSibs[i].node.id, {
          x: rightLeftEdge + NODE_WIDTH / 2,
          y: sibStartY + i * (NODE_HEIGHT + STACK_V_GAP),
        })
      }
    }
  }

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

  const centerBgTop = centerMinY - FOLDER_PAD - FOLDER_LABEL_H
  const centerBgBottom = centerMaxY + FOLDER_PAD

  const topRowY = Math.min(-MIN_ROW_SPACING, centerBgTop - ROW_GAP - NODE_HEIGHT / 2 - FOLDER_PAD)
  const bottomRowY = Math.max(
    MIN_ROW_SPACING,
    centerBgBottom + ROW_GAP + NODE_HEIGHT / 2 + FOLDER_PAD + FOLDER_LABEL_H,
  )

  const topRow = egoNodes.filter((en) => en.depth === -1)
  if (topRow.length > 0) layoutFolderRow(topRow, topRowY, positions, -1)

  const bottomRow = egoNodes.filter((en) => en.depth === 1)
  if (bottomRow.length > 0) layoutFolderRow(bottomRow, bottomRowY, positions, 1)

  return { positions }
}

export function pickHandles(
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

interface FolderBgData {
  folderLabel: string
  width: number
  height: number
  [key: string]: unknown
}

export function buildFolderBackgrounds(
  egoNodes: EgoNode[],
  positions: Map<string, { x: number; y: number }>,
): { id: string; position: { x: number; y: number }; data: FolderBgData }[] {
  const key = (depth: number, folder: string) => `${depth}::${folder}`
  const groups = new Map<string, { folder: string; items: { pos: { x: number; y: number } }[] }>()

  for (const en of egoNodes) {
    const pos = positions.get(en.node.id)
    if (!pos) continue
    const folder = en.node.folder || '.'
    const k = key(en.depth, folder)
    if (!groups.has(k)) groups.set(k, { folder, items: [] })
    groups.get(k)!.items.push({ pos })
  }

  const bgNodes: { id: string; position: { x: number; y: number }; data: FolderBgData }[] = []
  for (const [k, { folder, items }] of groups) {
    if (items.length === 0) continue

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const { pos } of items) {
      minX = Math.min(minX, pos.x - NODE_WIDTH / 2)
      minY = Math.min(minY, pos.y - NODE_HEIGHT / 2)
      maxX = Math.max(maxX, pos.x + NODE_WIDTH / 2)
      maxY = Math.max(maxY, pos.y + NODE_HEIGHT / 2)
    }

    const nodesSpan = maxX - minX
    const folderLabel = folder === '.' ? '(root)' : folder
    const labelW = measureFolderLabelWidth(folderLabel)
    const bgW = Math.max(labelW, nodesSpan + FOLDER_PAD * 2)
    const height = maxY - minY + FOLDER_PAD * 2 + FOLDER_LABEL_H

    const nodesCenterX = (minX + maxX) / 2
    const bgX = nodesCenterX - bgW / 2

    bgNodes.push({
      id: `__folder__${k}`,
      position: { x: bgX, y: minY - FOLDER_PAD - FOLDER_LABEL_H },
      data: { folderLabel, width: bgW, height },
    })
  }

  return bgNodes
}
