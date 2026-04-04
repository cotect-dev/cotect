import { describe, it, expect, beforeEach } from 'vitest'
import {
  useLayoutStore,
  getPanelLabel,
  getEffectivePosition,
  getSerializableLayout,
  loadLayoutIntoStore,
  PANEL_DEFINITIONS,
  type PanelPosition,
} from './layout'

describe('layout store - pure functions', () => {
  describe('getPanelLabel', () => {
    it('returns label for known panel', () => {
      expect(getPanelLabel('changes')).toBe('Changes')
      expect(getPanelLabel('chat')).toBe('Chat')
      expect(getPanelLabel('console')).toBe('Console')
      expect(getPanelLabel('history')).toBe('History')
      expect(getPanelLabel('branches')).toBe('Branches')
    })

    it('returns id for unknown panel', () => {
      expect(getPanelLabel('unknown-panel')).toBe('unknown-panel')
    })
  })

  describe('getEffectivePosition', () => {
    it('returns default position in main window', () => {
      expect(getEffectivePosition('changes', false)).toBe('left')
      expect(getEffectivePosition('chat', false)).toBe('right')
      expect(getEffectivePosition('console', false)).toBe('bottom')
    })

    it('returns fallback for bottom panels in child window', () => {
      expect(getEffectivePosition('console', true)).toBe('right')
    })

    it('returns default for non-bottom panels in child window', () => {
      expect(getEffectivePosition('changes', true)).toBe('left')
      expect(getEffectivePosition('chat', true)).toBe('right')
    })

    it('returns left for unknown panel', () => {
      expect(getEffectivePosition('nonexistent', false)).toBe('left')
    })
  })

  describe('PANEL_DEFINITIONS', () => {
    it('has 7 panel definitions', () => {
      expect(PANEL_DEFINITIONS).toHaveLength(7)
    })

    it('all panels have required fields', () => {
      for (const def of PANEL_DEFINITIONS) {
        expect(def.id).toBeTruthy()
        expect(def.label).toBeTruthy()
        expect(['left', 'right', 'bottom']).toContain(def.defaultPosition)
        expect(['git', 'tools', 'agent']).toContain(def.group)
      }
    })
  })
})

describe('layout store - state management', () => {
  beforeEach(() => {
    useLayoutStore.setState({
      panels: { left: [], right: [], bottom: [] },
      sizes: { left: [], right: [], bottom: [] },
      activeTab: {},
      crossWindowDrag: null,
    })
  })

  describe('addPanel', () => {
    it('adds a panel to the specified position', () => {
      useLayoutStore.getState().addPanel('chat', 'right')
      const { panels, sizes } = useLayoutStore.getState()
      expect(panels.right).toEqual([['chat']])
      expect(sizes.right).toEqual([1])
    })

    it('does not add duplicate panel', () => {
      useLayoutStore.getState().addPanel('chat', 'right')
      useLayoutStore.getState().addPanel('chat', 'left')
      expect(useLayoutStore.getState().panels.right).toEqual([['chat']])
      expect(useLayoutStore.getState().panels.left).toEqual([])
    })

    it('adds multiple panels to the same position with correctly distributed sizes', () => {
      useLayoutStore.getState().addPanel('changes', 'left')
      useLayoutStore.getState().addPanel('history', 'left')
      const { panels, sizes } = useLayoutStore.getState()
      expect(panels.left).toHaveLength(2)
      expect(panels.left[0]).toEqual(['changes'])
      expect(panels.left[1]).toEqual(['history'])
      // sizes should sum to 1 and be evenly distributed
      expect(sizes.left[0] + sizes.left[1]).toBeCloseTo(1, 5)
      expect(sizes.left).toEqual([0.5, 0.5])
    })
  })

  describe('removePanel', () => {
    it('removes a panel', () => {
      useLayoutStore.getState().addPanel('chat', 'right')
      useLayoutStore.getState().removePanel('chat')
      expect(useLayoutStore.getState().panels.right).toEqual([])
    })

    it('does nothing for nonexistent panel', () => {
      useLayoutStore.getState().addPanel('chat', 'right')
      useLayoutStore.getState().removePanel('nonexistent')
      expect(useLayoutStore.getState().panels.right).toEqual([['chat']])
    })
  })

  describe('movePanel', () => {
    it('moves a panel from one position to another', () => {
      useLayoutStore.getState().addPanel('chat', 'right')
      useLayoutStore.getState().movePanel('chat', 'left', 0)
      const { panels } = useLayoutStore.getState()
      expect(panels.right).toEqual([])
      expect(panels.left).toEqual([['chat']])
    })
  })

  describe('movePanelToTab', () => {
    it('moves a panel into another group as a tab', () => {
      useLayoutStore.getState().addPanel('changes', 'left')
      useLayoutStore.getState().addPanel('history', 'left')
      useLayoutStore.getState().movePanelToTab('history', 'changes')
      const { panels } = useLayoutStore.getState()
      expect(panels.left).toHaveLength(1)
      expect(panels.left[0]).toEqual(['changes', 'history'])
    })

    it('does nothing when moving to same panel', () => {
      useLayoutStore.getState().addPanel('chat', 'right')
      useLayoutStore.getState().movePanelToTab('chat', 'chat')
      const { panels } = useLayoutStore.getState()
      expect(panels.right).toEqual([['chat']])
    })
  })

  describe('resizePanels', () => {
    it('resizes adjacent panels', () => {
      useLayoutStore.getState().addPanel('changes', 'left')
      useLayoutStore.getState().addPanel('history', 'left')
      useLayoutStore.getState().resizePanels('left', 0, 0.7)
      const { sizes } = useLayoutStore.getState()
      // sizes should sum to original total
      const total = sizes.left[0] + sizes.left[1]
      expect(total).toBeCloseTo(1, 5)
      expect(sizes.left[0]).toBeGreaterThan(sizes.left[1])
    })

    it('no-ops on out-of-bounds index', () => {
      useLayoutStore.getState().addPanel('changes', 'left')
      useLayoutStore.getState().addPanel('history', 'left')
      const sizesBefore = [...useLayoutStore.getState().sizes.left]
      // index 1 has no index 2 neighbor
      useLayoutStore.getState().resizePanels('left', 1, 0.5)
      expect(useLayoutStore.getState().sizes.left).toEqual(sizesBefore)
    })

    it('no-ops on negative index', () => {
      useLayoutStore.getState().addPanel('changes', 'left')
      useLayoutStore.getState().addPanel('history', 'left')
      const sizesBefore = [...useLayoutStore.getState().sizes.left]
      useLayoutStore.getState().resizePanels('left', -1, 0.5)
      expect(useLayoutStore.getState().sizes.left).toEqual(sizesBefore)
    })
  })

  describe('setActiveTab', () => {
    it('sets the active tab for a group', () => {
      useLayoutStore.getState().setActiveTab('changes', 2)
      expect(useLayoutStore.getState().activeTab['changes']).toBe(2)
    })
  })

  describe('setCrossWindowDrag', () => {
    it('sets cross window drag data', () => {
      const drag = { panelId: 'chat', panelIds: ['chat'], position: 'right' as PanelPosition, insertIndex: 0, neighborIndex: 0 }
      useLayoutStore.getState().setCrossWindowDrag(drag)
      expect(useLayoutStore.getState().crossWindowDrag).toEqual(drag)
    })

    it('clears cross window drag', () => {
      useLayoutStore.getState().setCrossWindowDrag({ panelId: 'chat', panelIds: ['chat'], position: 'right' as PanelPosition, insertIndex: 0, neighborIndex: 0 })
      useLayoutStore.getState().setCrossWindowDrag(null)
      expect(useLayoutStore.getState().crossWindowDrag).toBeNull()
    })
  })

  describe('getSerializableLayout / loadLayoutIntoStore', () => {
    it('round-trips layout state', () => {
      useLayoutStore.getState().addPanel('changes', 'left')
      useLayoutStore.getState().addPanel('chat', 'right')
      useLayoutStore.getState().setActiveTab('changes', 0)

      const serialized = getSerializableLayout()
      expect(serialized.panels.left).toEqual([['changes']])
      expect(serialized.panels.right).toEqual([['chat']])

      // Reset and restore
      useLayoutStore.setState({ panels: { left: [], right: [], bottom: [] }, sizes: { left: [], right: [], bottom: [] }, activeTab: {} })
      loadLayoutIntoStore(serialized)

      const restored = useLayoutStore.getState()
      expect(restored.panels.left).toEqual([['changes']])
      expect(restored.panels.right).toEqual([['chat']])
      expect(restored.activeTab['changes']).toBe(0)
    })
  })
})
