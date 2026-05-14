export const EDGE_THRESHOLD = 0.25
export const BOTTOM_EDGE_THRESHOLD = 0.75
export const PANEL_SPLIT = 0.5

export type DropPosition = 'left' | 'right' | 'bottom'

export interface DropZoneRect {
  left: number
  top: number
  width: number
  height: number
}

export interface DropZoneInfo {
  rect: DropZoneRect
  isVertical: boolean
}

export function computeInsertIndex(
  zone: DropZoneInfo,
  sizes: number[],
  pointerX: number,
  pointerY: number,
): { insertIndex: number; neighborIndex: number } {
  if (sizes.length === 0) return { insertIndex: 0, neighborIndex: 0 }

  const { rect, isVertical } = zone
  const totalSize = sizes.reduce((a, b) => a + b, 0)
  const relativePos = isVertical
    ? (pointerY - rect.top) / rect.height
    : (pointerX - rect.left) / rect.width

  let cumulative = 0
  for (let i = 0; i < sizes.length; i++) {
    const panelEnd = (cumulative + sizes[i]) / totalSize
    if (relativePos < panelEnd) {
      const panelMid = (cumulative + sizes[i] / 2) / totalSize
      if (relativePos < panelMid) {
        return { insertIndex: i, neighborIndex: i }
      } else {
        return { insertIndex: i + 1, neighborIndex: i }
      }
    }
    cumulative += sizes[i]
  }
  return { insertIndex: sizes.length, neighborIndex: sizes.length - 1 }
}

export function detectDropZone(
  x: number,
  y: number,
  viewportW: number,
  viewportH: number,
  mode: 'main' | 'panel',
): DropPosition | null {
  const nx = x / viewportW
  const ny = y / viewportH

  if (mode === 'panel') {
    return nx < PANEL_SPLIT ? 'left' : 'right'
  }

  if (ny > BOTTOM_EDGE_THRESHOLD) return 'bottom'
  if (nx < EDGE_THRESHOLD) return 'left'
  if (nx > 1 - EDGE_THRESHOLD) return 'right'
  return null
}
