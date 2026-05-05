/**
 * Pure pointer-driven drop-zone math shared between the in-window dnd-kit
 * drag (`usePanelDrag`) and the cross-window overlay (`CrossWindowDropOverlay`).
 */

export const EDGE_THRESHOLD = 0.25
/** y above this fraction of viewport drops into the bottom zone. */
export const BOTTOM_EDGE_THRESHOLD = 0.75
/** Split point used in panel-mode (left/right halves only). */
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

/**
 * Bisect-on-mid against pointer position. Caller filters the dragged panel
 * out of `sizes` first when it lives in this zone.
 *
 * - `insertIndex`: position the new panel will occupy.
 * - `neighborIndex`: nearest existing panel; resize math uses it to pick
 *   which neighbor donates the space.
 *
 * Empty `sizes` yields `{0, 0}`.
 */
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

/**
 * `mode: 'panel'` only ever returns 'left' or 'right' (split at PANEL_SPLIT).
 * `mode: 'main'` may return null when the pointer is in the dead zone.
 */
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
