import { describe, it, expect } from 'vitest'
import {
  MIN_SIDE_ZONE,
  MIN_BOTTOM_ZONE,
  NODE_WIDTH,
  NODE_HEIGHT,
  NODE_H_GAP,
  NODE_V_GAP,
  DEFAULT_MAIN_LAYOUT,
} from './constants'

describe('constants', () => {
  it('MIN_SIDE_ZONE is a positive number', () => {
    expect(MIN_SIDE_ZONE).toBeGreaterThan(0)
    expect(typeof MIN_SIDE_ZONE).toBe('number')
  })

  it('MIN_BOTTOM_ZONE is a positive number', () => {
    expect(MIN_BOTTOM_ZONE).toBeGreaterThan(0)
    expect(typeof MIN_BOTTOM_ZONE).toBe('number')
  })

  it('NODE dimensions are positive numbers', () => {
    expect(NODE_WIDTH).toBeGreaterThan(0)
    expect(NODE_HEIGHT).toBeGreaterThan(0)
    expect(NODE_H_GAP).toBeGreaterThan(0)
    expect(NODE_V_GAP).toBeGreaterThan(0)
  })

  it('DEFAULT_MAIN_LAYOUT has correct structure', () => {
    expect(DEFAULT_MAIN_LAYOUT).toHaveProperty('panels')
    expect(DEFAULT_MAIN_LAYOUT).toHaveProperty('sizes')
    expect(DEFAULT_MAIN_LAYOUT).toHaveProperty('activeTab')

    expect(DEFAULT_MAIN_LAYOUT.panels).toHaveProperty('left')
    expect(DEFAULT_MAIN_LAYOUT.panels).toHaveProperty('right')
    expect(DEFAULT_MAIN_LAYOUT.panels).toHaveProperty('bottom')

    expect(DEFAULT_MAIN_LAYOUT.sizes).toHaveProperty('left')
    expect(DEFAULT_MAIN_LAYOUT.sizes).toHaveProperty('right')
    expect(DEFAULT_MAIN_LAYOUT.sizes).toHaveProperty('bottom')
  })

  it('DEFAULT_MAIN_LAYOUT panels contain expected panel IDs', () => {
    const allPanelIds = [
      ...DEFAULT_MAIN_LAYOUT.panels.left.flat(),
      ...DEFAULT_MAIN_LAYOUT.panels.right.flat(),
      ...DEFAULT_MAIN_LAYOUT.panels.bottom.flat(),
    ]
    expect(allPanelIds).toContain('changes')
    expect(allPanelIds).toContain('chat')
    expect(allPanelIds).toContain('console')
  })
})
