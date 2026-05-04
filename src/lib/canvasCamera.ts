import { CANVAS_MARGIN, NODE_WIDTH, NODE_HEIGHT, NODE_H_GAP } from './constants'

export interface Viewport {
  x: number
  y: number
}

export interface FocusPosition {
  x: number
  y: number
}

export interface ContainerSize {
  width: number
  height: number
}

/**
 * Anchor target: place the current column flush with the left panel — its
 * left edge sits CANVAS_MARGIN px to the right of panelW — and reset Y so
 * the top of the column is CANVAS_MARGIN below the top of the canvas.
 *
 * The returned position is exactly on the boundary of the focused-node
 * clamp's safe zone, so a subsequent clampToFocus is a no-op when the
 * focused node sits at the column's top-left corner.
 */
export function anchorViewport(currentColumnIndex: number, panelW: number): Viewport {
  const columnStep = NODE_WIDTH + NODE_H_GAP
  const currentColX = currentColumnIndex * columnStep
  return {
    x: CANVAS_MARGIN + panelW - currentColX,
    y: CANVAS_MARGIN,
  }
}

/**
 * Y-only clamp shared between the live viewport and the store's preview
 * simulation. Returns prevY unchanged when the focused node is already in
 * the safe zone or when viewportHeight has not been measured yet.
 */
export function clampY(prevY: number, focusedNodeY: number, viewportHeight: number): number {
  if (viewportHeight <= 0) return prevY
  const screenY = focusedNodeY + prevY
  if (screenY < CANVAS_MARGIN) {
    return -focusedNodeY + CANVAS_MARGIN
  }
  if (screenY + NODE_HEIGHT > viewportHeight - CANVAS_MARGIN) {
    return viewportHeight - CANVAS_MARGIN - focusedNodeY - NODE_HEIGHT
  }
  return prevY
}

/**
 * Clamp the focused node into the safe zone bounded by CANVAS_MARGIN on
 * every edge (with the left panel taking the place of the left screen
 * edge). Returns prev unchanged when the node is already inside.
 */
export function clampToFocus(
  prev: Viewport,
  focused: FocusPosition,
  panelW: number,
  container: ContainerSize,
): Viewport {
  let x = prev.x
  if (container.width > 0) {
    const screenX = focused.x + prev.x
    if (screenX < panelW + CANVAS_MARGIN) {
      x = -focused.x + panelW + CANVAS_MARGIN
    } else if (screenX + NODE_WIDTH > container.width - CANVAS_MARGIN) {
      x = container.width - CANVAS_MARGIN - focused.x - NODE_WIDTH
    }
  }
  const y = clampY(prev.y, focused.y, container.height)
  return { x, y }
}
