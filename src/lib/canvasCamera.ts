import { CANVAS_MARGIN, NODE_WIDTH, NODE_HEIGHT, NODE_H_GAP } from './canvasGeometry'

export interface Viewport {
  x: number
  y: number
}

interface FocusPosition {
  x: number
  y: number
}

interface ContainerSize {
  width: number
  height: number
}

export function anchorViewport(currentColumnIndex: number, panelW: number): Viewport {
  const columnStep = NODE_WIDTH + NODE_H_GAP
  const currentColX = currentColumnIndex * columnStep
  return {
    x: CANVAS_MARGIN + panelW - currentColX,
    y: CANVAS_MARGIN,
  }
}

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
