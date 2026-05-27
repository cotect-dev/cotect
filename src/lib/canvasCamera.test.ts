import { describe, it, expect } from 'vitest'
import { anchorViewport, clampToFocus, clampY } from './canvasCamera'
import { CANVAS_MARGIN, NODE_WIDTH, NODE_HEIGHT, NODE_H_GAP } from './canvasGeometry'

const STEP = NODE_WIDTH + NODE_H_GAP

describe('anchorViewport', () => {
  it('places column 0 right after the panel at MARGIN', () => {
    const vp = anchorViewport(0, 200)
    // canvas-X 0 maps to screen-X = 0 + vp.x = panelW + MARGIN
    expect(vp.x).toBe(200 + CANVAS_MARGIN)
    expect(vp.y).toBe(CANVAS_MARGIN)
  })

  it('shifts viewport so the chosen column lands at panelW + MARGIN', () => {
    const colIndex = 3
    const panelW = 150
    const vp = anchorViewport(colIndex, panelW)
    // canvas-X of column = colIndex * STEP. Screen-X = canvas-X + vp.x.
    const screenX = colIndex * STEP + vp.x
    expect(screenX).toBe(panelW + CANVAS_MARGIN)
  })

  it('handles a panel width of 0 (no panel rendered yet)', () => {
    const vp = anchorViewport(0, 0)
    expect(vp.x).toBe(CANVAS_MARGIN)
    expect(vp.y).toBe(CANVAS_MARGIN)
  })
})

describe('clampY', () => {
  it('returns prevY when viewportHeight is 0 (not measured)', () => {
    expect(clampY(42, 0, 0)).toBe(42)
  })

  it('returns prevY when focused node is in the safe zone', () => {
    // viewportHeight = 600, MARGIN = 60, NODE_HEIGHT = 56
    // node at canvasY=100 with prevY=60 → screenY=160, in safe zone
    expect(clampY(60, 100, 600)).toBe(60)
  })

  it('clamps down when focused node would render above the top margin', () => {
    // node at canvasY=0 with prevY=20 → screenY=20 < MARGIN=60
    // newY = -0 + 60 = 60 → screenY = 60 ✓
    expect(clampY(20, 0, 600)).toBe(CANVAS_MARGIN)
  })

  it('clamps up when focused node would render below the bottom margin', () => {
    // viewportHeight=300, MARGIN=60, NODE_HEIGHT=56
    // node at canvasY=400 with prevY=0 → screenY=400, way past bottom
    // newY = 300 - 60 - 400 - 56 = -216
    const result = clampY(0, 400, 300)
    expect(result).toBe(300 - CANVAS_MARGIN - 400 - NODE_HEIGHT)
    // Verify: screenY + NODE_HEIGHT = 400 + (-216) + 56 = 240 = viewportH - MARGIN ✓
    expect(400 + result + NODE_HEIGHT).toBe(300 - CANVAS_MARGIN)
  })

  it('is idempotent: clamping an already-clamped value does nothing', () => {
    const once = clampY(0, 0, 600)
    const twice = clampY(once, 0, 600)
    expect(once).toBe(twice)
  })
})

describe('clampToFocus', () => {
  const container = { width: 1000, height: 800 }
  const panelW = 200

  it('returns prev unchanged when node is in the safe zone', () => {
    // Anchor positions current column at panelW + MARGIN screen-X.
    // A node at canvas-X=0 with anchored prev should be inside.
    const prev = anchorViewport(0, panelW)
    const result = clampToFocus(prev, { x: 0, y: 0 }, panelW, container)
    expect(result).toEqual(prev)
  })

  it('does not nudge a node sitting exactly on the left margin boundary', () => {
    // Anchor places the column at exactly panelW + MARGIN. The strict `<`
    // check must not fire on the boundary — that was the original bug.
    const prev = anchorViewport(2, panelW)
    const focused = { x: 2 * STEP, y: 0 }
    const result = clampToFocus(prev, focused, panelW, container)
    expect(result).toEqual(prev)
  })

  it('clamps right when node hangs off the left panel', () => {
    const focused = { x: 100, y: 0 }
    const prev = { x: 0, y: CANVAS_MARGIN } // screenX = 100, < panelW + MARGIN = 260
    const result = clampToFocus(prev, focused, panelW, container)
    expect(result.x).toBe(-100 + panelW + CANVAS_MARGIN)
    // screenX after clamp = 100 + result.x = panelW + MARGIN
    expect(focused.x + result.x).toBe(panelW + CANVAS_MARGIN)
  })

  it('clamps left when node would extend past the right margin', () => {
    const focused = { x: 800, y: 0 }
    const prev = { x: 200, y: CANVAS_MARGIN }
    // screenX = 1000, screenX + NODE_WIDTH = 1180, > 1000 - 60 = 940
    const result = clampToFocus(prev, focused, panelW, container)
    expect(result.x).toBe(1000 - CANVAS_MARGIN - 800 - NODE_WIDTH)
    expect(focused.x + result.x + NODE_WIDTH).toBe(1000 - CANVAS_MARGIN)
  })

  it('skips X clamp when container width is 0 (not measured)', () => {
    const result = clampToFocus({ x: -1000, y: CANVAS_MARGIN }, { x: 0, y: 0 }, panelW, {
      width: 0,
      height: 800,
    })
    expect(result.x).toBe(-1000)
  })

  it('clamps Y independently of X', () => {
    // Y off bottom, X in safe zone
    const prev = anchorViewport(0, panelW)
    const focused = { x: 0, y: 1000 } // way down
    const result = clampToFocus(prev, focused, panelW, container)
    expect(result.x).toBe(prev.x) // X unchanged
    expect(result.y).toBe(800 - CANVAS_MARGIN - 1000 - NODE_HEIGHT)
  })

  it('round-trip: anchor → clamp is a no-op for first node in current column', () => {
    // The whole point of aligning PAD with MARGIN: anchor's output is
    // already inside the safe zone, so clamp doesn't fight it.
    for (const colIndex of [0, 1, 2, 5]) {
      const anchored = anchorViewport(colIndex, panelW)
      const focused = { x: colIndex * STEP, y: 0 }
      const clamped = clampToFocus(anchored, focused, panelW, container)
      expect(clamped).toEqual(anchored)
    }
  })
})
