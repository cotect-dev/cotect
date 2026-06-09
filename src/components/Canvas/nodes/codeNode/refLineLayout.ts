import type { ImportRefItem } from '@/types/nodes'
import type { ImportRef } from '@/store/canvas'

export interface RefLine {
  items: ImportRefItem[]
  showConnector: boolean
}

function toItem(ref: ImportRef): ImportRefItem {
  return {
    label: ref.label,
    resolvedPath: ref.resolvedPath,
    kind: ref.kind,
    targetLine: ref.targetLine,
  }
}

/**
 * Splits import refs into the two overlay layers a CodeNode renders:
 *  - `inlineImports`: `import` refs, shown as pills at the right edge of their line.
 *  - `rightSide`: `imported-by` refs, packed into a column to the right of the
 *    editor. When several share an anchor line they spill downward into a grid
 *    so they don't overlap, and the anchor line gets a labelled connector.
 */
export function computeRefLineLayouts(refs: ImportRef[]): {
  inlineImports: Map<number, ImportRefItem[]>
  rightSide: Map<number, RefLine>
} {
  const inlineImports = new Map<number, ImportRefItem[]>()
  for (const ref of refs.filter((r) => r.kind === 'import')) {
    if (!inlineImports.has(ref.line)) inlineImports.set(ref.line, [])
    inlineImports.get(ref.line)!.push(toItem(ref))
  }

  const rightSide = new Map<number, RefLine>()
  const importedBy = refs.filter((r) => r.kind === 'imported-by')
  if (importedBy.length === 0) return { inlineImports, rightSide }

  const ibByLine = new Map<number, ImportRef[]>()
  for (const ref of importedBy) {
    if (!ibByLine.has(ref.line)) ibByLine.set(ref.line, [])
    ibByLine.get(ref.line)!.push(ref)
  }

  const lineEntries = new Map<number, ImportRef[]>()
  const add = (line: number, ref: ImportRef) => {
    if (!lineEntries.has(line)) lineEntries.set(line, [])
    lineEntries.get(line)!.push(ref)
  }

  const ibAnchorLines = new Set<number>()
  const sortedAnchors = [...ibByLine.keys()].sort((a, b) => a - b)
  for (const anchorLine of sortedAnchors) {
    ibAnchorLines.add(anchorLine)
    const group = ibByLine.get(anchorLine)!
    const count = group.length
    let maxRows = 0
    let probe = anchorLine
    while (maxRows < count) {
      const occupants = lineEntries.get(probe)
      if (occupants && occupants.some((r) => r.kind === 'imported-by')) break
      maxRows++
      probe++
    }
    if (maxRows < 1) maxRows = 1
    const numCols = Math.ceil(count / maxRows)
    const rowsPerCol = Math.ceil(count / numCols)
    for (let ri = 0; ri < count; ri++) {
      const line = anchorLine + (ri % rowsPerCol)
      add(line, group[ri])
    }
  }

  for (const [line, entries] of lineEntries) {
    rightSide.set(line, {
      items: entries.map(toItem),
      showConnector: ibAnchorLines.has(line),
    })
  }

  return { inlineImports, rightSide }
}
