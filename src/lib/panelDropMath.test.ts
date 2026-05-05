import { describe, it, expect } from 'vitest'
import {
  computeInsertIndex,
  detectDropZone,
  EDGE_THRESHOLD,
  BOTTOM_EDGE_THRESHOLD,
  PANEL_SPLIT,
} from './panelDropMath'

const horizontalRect = { left: 0, top: 0, width: 1000, height: 100 }
const verticalRect = { left: 0, top: 0, width: 100, height: 1000 }

describe('computeInsertIndex', () => {
  it('returns {0,0} for empty sizes', () => {
    const result = computeInsertIndex({ rect: horizontalRect, isVertical: false }, [], 500, 50)
    expect(result).toEqual({ insertIndex: 0, neighborIndex: 0 })
  })

  it('single panel: pointer in left half inserts before, right half inserts after', () => {
    const zone = { rect: horizontalRect, isVertical: false }
    // left quarter — relative 0.25, mid is 0.5, so before
    expect(computeInsertIndex(zone, [1], 250, 50)).toEqual({ insertIndex: 0, neighborIndex: 0 })
    // right quarter — relative 0.75, after the mid
    expect(computeInsertIndex(zone, [1], 750, 50)).toEqual({ insertIndex: 1, neighborIndex: 0 })
  })

  it('two-panel bisect: left half of first → insert=neighbor=0', () => {
    const zone = { rect: horizontalRect, isVertical: false }
    // Two panels of size 1 each → first panel covers relative 0..0.5, mid=0.25
    // pointer at 100 (relative 0.1) → before mid → {0,0}
    expect(computeInsertIndex(zone, [1, 1], 100, 50)).toEqual({ insertIndex: 0, neighborIndex: 0 })
  })

  it('two-panel bisect: right half of first → insert=1, neighbor=0', () => {
    const zone = { rect: horizontalRect, isVertical: false }
    // pointer at 400 (relative 0.4) → past mid 0.25, before panelEnd 0.5 → {1,0}
    expect(computeInsertIndex(zone, [1, 1], 400, 50)).toEqual({ insertIndex: 1, neighborIndex: 0 })
  })

  it('two-panel bisect: left half of second → insert=1 (=neighbor), right half → insert=2', () => {
    const zone = { rect: horizontalRect, isVertical: false }
    // pointer at 600 (relative 0.6) → past first panelEnd 0.5, before second mid 0.75 → {1,1}
    expect(computeInsertIndex(zone, [1, 1], 600, 50)).toEqual({ insertIndex: 1, neighborIndex: 1 })
    // pointer at 900 (relative 0.9) → past second mid → {2,1}
    expect(computeInsertIndex(zone, [1, 1], 900, 50)).toEqual({ insertIndex: 2, neighborIndex: 1 })
  })

  it('three panels with equal sizes: each third partitions correctly', () => {
    const zone = { rect: horizontalRect, isVertical: false }
    // 3 equal panels: panelEnds at 1/3, 2/3, 1; mids at 1/6, 3/6, 5/6
    expect(computeInsertIndex(zone, [1, 1, 1], 100, 50)).toEqual({ insertIndex: 0, neighborIndex: 0 }) // 0.1 < 1/6
    expect(computeInsertIndex(zone, [1, 1, 1], 250, 50)).toEqual({ insertIndex: 1, neighborIndex: 0 }) // past 1/6, before 1/3
    expect(computeInsertIndex(zone, [1, 1, 1], 400, 50)).toEqual({ insertIndex: 1, neighborIndex: 1 }) // past 1/3, before 1/2
    expect(computeInsertIndex(zone, [1, 1, 1], 600, 50)).toEqual({ insertIndex: 2, neighborIndex: 1 }) // past 1/2, before 2/3
    expect(computeInsertIndex(zone, [1, 1, 1], 750, 50)).toEqual({ insertIndex: 2, neighborIndex: 2 }) // past 2/3, before 5/6
    expect(computeInsertIndex(zone, [1, 1, 1], 950, 50)).toEqual({ insertIndex: 3, neighborIndex: 2 }) // past 5/6
  })

  it('vertical orientation uses pointerY against rect.top/height', () => {
    const zone = { rect: verticalRect, isVertical: true }
    // Two equal panels stacked vertically — mid of first is at y=250
    expect(computeInsertIndex(zone, [1, 1], 50, 100)).toEqual({ insertIndex: 0, neighborIndex: 0 })
    expect(computeInsertIndex(zone, [1, 1], 50, 400)).toEqual({ insertIndex: 1, neighborIndex: 0 })
    expect(computeInsertIndex(zone, [1, 1], 50, 600)).toEqual({ insertIndex: 1, neighborIndex: 1 })
    expect(computeInsertIndex(zone, [1, 1], 50, 900)).toEqual({ insertIndex: 2, neighborIndex: 1 })
  })

  it('respects unequal sizes', () => {
    const zone = { rect: horizontalRect, isVertical: false }
    // sizes [3, 1] → total 4 → first panel covers 0..0.75 (mid at 0.375)
    // pointer at 200 (relative 0.2) → before mid → {0,0}
    expect(computeInsertIndex(zone, [3, 1], 200, 50)).toEqual({ insertIndex: 0, neighborIndex: 0 })
    // pointer at 500 (relative 0.5) → past mid 0.375, before 0.75 → {1,0}
    expect(computeInsertIndex(zone, [3, 1], 500, 50)).toEqual({ insertIndex: 1, neighborIndex: 0 })
    // pointer at 800 (relative 0.8) → past 0.75 (into second panel), second mid 0.875 → before mid → {1,1}
    expect(computeInsertIndex(zone, [3, 1], 800, 50)).toEqual({ insertIndex: 1, neighborIndex: 1 })
  })

  it('honors non-zero rect origin', () => {
    const zone = { rect: { left: 100, top: 50, width: 1000, height: 100 }, isVertical: false }
    // pointer at clientX=600 → relative (600 - 100) / 1000 = 0.5
    // single panel mid 0.5 → past mid (strict <) → {1,0}
    expect(computeInsertIndex(zone, [1], 600, 100)).toEqual({ insertIndex: 1, neighborIndex: 0 })
  })
})

describe('detectDropZone (main mode)', () => {
  const W = 1000
  const H = 1000

  it('returns left when x < EDGE_THRESHOLD', () => {
    expect(detectDropZone(EDGE_THRESHOLD * W - 1, H / 2, W, H, 'main')).toBe('left')
  })

  it('returns right when x > 1 - EDGE_THRESHOLD', () => {
    expect(detectDropZone((1 - EDGE_THRESHOLD) * W + 1, H / 2, W, H, 'main')).toBe('right')
  })

  it('returns bottom when y > BOTTOM_EDGE_THRESHOLD (precedence over x)', () => {
    // bottom takes precedence even on a left/right column
    expect(detectDropZone(50, BOTTOM_EDGE_THRESHOLD * H + 1, W, H, 'main')).toBe('bottom')
    expect(detectDropZone(W - 50, BOTTOM_EDGE_THRESHOLD * H + 1, W, H, 'main')).toBe('bottom')
  })

  it('returns null in the dead zone (center of viewport)', () => {
    expect(detectDropZone(W / 2, H / 2, W, H, 'main')).toBe(null)
  })

  it('boundary: x exactly at EDGE_THRESHOLD is not left (strict <)', () => {
    // 0.25 not < 0.25 → falls through, also not > 0.75 → null
    expect(detectDropZone(EDGE_THRESHOLD * W, H / 2, W, H, 'main')).toBe(null)
  })

  it('boundary: y exactly at BOTTOM_EDGE_THRESHOLD is not bottom (strict >)', () => {
    expect(detectDropZone(W / 2, BOTTOM_EDGE_THRESHOLD * H, W, H, 'main')).toBe(null)
  })
})

describe('detectDropZone (panel mode)', () => {
  it('returns left when x < PANEL_SPLIT, right otherwise', () => {
    expect(detectDropZone(100, 100, 1000, 1000, 'panel')).toBe('left')
    expect(detectDropZone(PANEL_SPLIT * 1000 - 1, 100, 1000, 1000, 'panel')).toBe('left')
    expect(detectDropZone(PANEL_SPLIT * 1000, 100, 1000, 1000, 'panel')).toBe('right')
    expect(detectDropZone(900, 100, 1000, 1000, 'panel')).toBe('right')
  })

  it('panel mode never returns bottom or null', () => {
    // Even at the very bottom, panel mode picks left/right
    expect(detectDropZone(100, 990, 1000, 1000, 'panel')).toBe('left')
    expect(detectDropZone(900, 990, 1000, 1000, 'panel')).toBe('right')
  })
})
