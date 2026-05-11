import { describe, it, expect, beforeEach } from 'vitest'
import {
  useLayoutStore,
  getPanelLabel,
  getEffectivePosition,
  getSerializableLayout,
  loadLayoutIntoStore,
  DEFAULT_ZONE_SIZES,
  type PanelPosition,
} from './layout'

describe('layout store - pure functions', () => {
  describe('getPanelLabel', () => {
    it('returns label for known panel', () => {
      expect(getPanelLabel('changes')).toBe('Changes')
      expect(getPanelLabel('tasks')).toBe('Tasks')
      expect(getPanelLabel('console')).toBe('Console')
      expect(getPanelLabel('history')).toBe('History')
    })

    it('returns id for unknown panel', () => {
      expect(getPanelLabel('unknown-panel')).toBe('unknown-panel')
    })
  })

  describe('getEffectivePosition', () => {
    it('returns default position in main window', () => {
      expect(getEffectivePosition('changes', false)).toBe('left')
      expect(getEffectivePosition('tasks', false)).toBe('right')
      expect(getEffectivePosition('console', false)).toBe('bottom')
    })

    it('returns fallback for bottom panels in child window', () => {
      expect(getEffectivePosition('console', true)).toBe('right')
    })

    it('returns default for non-bottom panels in child window', () => {
      expect(getEffectivePosition('changes', true)).toBe('left')
      expect(getEffectivePosition('tasks', true)).toBe('right')
    })

    it('returns left for unknown panel', () => {
      expect(getEffectivePosition('nonexistent', false)).toBe('left')
    })
  })
})

describe('layout store - state management', () => {
  beforeEach(() => {
    useLayoutStore.setState({
      panels: { left: [], right: [], bottom: [] },
      sizes: { left: [], right: [], bottom: [] },
      activeTab: {},
      zoneSizes: { ...DEFAULT_ZONE_SIZES },
      crossWindowDrag: null,
    })
  })

  describe('addPanel', () => {
    it('adds a panel to the specified position', () => {
      useLayoutStore.getState().addPanel('tasks', 'right')
      const { panels, sizes } = useLayoutStore.getState()
      expect(panels.right).toEqual([['tasks']])
      expect(sizes.right).toEqual([1])
    })

    it('does not add duplicate panel', () => {
      useLayoutStore.getState().addPanel('tasks', 'right')
      useLayoutStore.getState().addPanel('tasks', 'left')
      expect(useLayoutStore.getState().panels.right).toEqual([['tasks']])
      expect(useLayoutStore.getState().panels.left).toEqual([])
    })

    it('adds multiple panels to the same position with correctly distributed sizes', () => {
      useLayoutStore.getState().addPanel('changes', 'left')
      useLayoutStore.getState().addPanel('history', 'left')
      const { panels, sizes } = useLayoutStore.getState()
      expect(panels.left).toHaveLength(2)
      expect(panels.left[0]).toEqual(['changes'])
      expect(panels.left[1]).toEqual(['history'])
      expect(sizes.left[0] + sizes.left[1]).toBeCloseTo(1, 5)
      expect(sizes.left).toEqual([0.5, 0.5])
    })
  })

  describe('removePanel', () => {
    it('removes a panel', () => {
      useLayoutStore.getState().addPanel('tasks', 'right')
      useLayoutStore.getState().removePanel('tasks')
      expect(useLayoutStore.getState().panels.right).toEqual([])
    })

    it('does nothing for nonexistent panel', () => {
      useLayoutStore.getState().addPanel('tasks', 'right')
      useLayoutStore.getState().removePanel('nonexistent')
      expect(useLayoutStore.getState().panels.right).toEqual([['tasks']])
    })
  })

  describe('movePanel', () => {
    it('moves a panel from one position to another', () => {
      useLayoutStore.getState().addPanel('tasks', 'right')
      useLayoutStore.getState().movePanel('tasks', 'left', 0)
      const { panels } = useLayoutStore.getState()
      expect(panels.right).toEqual([])
      expect(panels.left).toEqual([['tasks']])
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
      useLayoutStore.getState().addPanel('tasks', 'right')
      useLayoutStore.getState().movePanelToTab('tasks', 'tasks')
      const { panels } = useLayoutStore.getState()
      expect(panels.right).toEqual([['tasks']])
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
      const drag = {
        panelId: 'tasks',
        panelIds: ['tasks'],
        position: 'right' as PanelPosition,
        insertIndex: 0,
        neighborIndex: 0,
      }
      useLayoutStore.getState().setCrossWindowDrag(drag)
      expect(useLayoutStore.getState().crossWindowDrag).toEqual(drag)
    })

    it('clears cross window drag', () => {
      useLayoutStore.getState().setCrossWindowDrag({
        panelId: 'tasks',
        panelIds: ['tasks'],
        position: 'right' as PanelPosition,
        insertIndex: 0,
        neighborIndex: 0,
      })
      useLayoutStore.getState().setCrossWindowDrag(null)
      expect(useLayoutStore.getState().crossWindowDrag).toBeNull()
    })
  })

  describe('getSerializableLayout / loadLayoutIntoStore', () => {
    it('round-trips layout state', () => {
      useLayoutStore.getState().addPanel('changes', 'left')
      useLayoutStore.getState().addPanel('tasks', 'right')
      useLayoutStore.getState().setActiveTab('changes', 0)

      const serialized = getSerializableLayout()
      expect(serialized.panels.left).toEqual([['changes']])
      expect(serialized.panels.right).toEqual([['tasks']])

      useLayoutStore.setState({
        panels: { left: [], right: [], bottom: [] },
        sizes: { left: [], right: [], bottom: [] },
        activeTab: {},
        zoneSizes: { ...DEFAULT_ZONE_SIZES },
      })
      loadLayoutIntoStore(serialized)

      const restored = useLayoutStore.getState()
      expect(restored.panels.left).toEqual([['changes']])
      expect(restored.panels.right).toEqual([['tasks']])
      expect(restored.activeTab['changes']).toBe(0)
    })
  })

  describe('setZoneSizes', () => {
    it('merges partial zoneSizes', () => {
      useLayoutStore.getState().setZoneSizes({ left: 0.3 })
      expect(useLayoutStore.getState().zoneSizes).toEqual({ ...DEFAULT_ZONE_SIZES, left: 0.3 })
    })

    it('serializes zoneSizes through the round-trip', () => {
      useLayoutStore.getState().setZoneSizes({ left: 0.4, right: 0.15, bottom: 0.3 })
      const serialized = getSerializableLayout()
      expect(serialized.zoneSizes).toEqual({ left: 0.4, right: 0.15, bottom: 0.3 })

      useLayoutStore.setState({
        panels: { left: [], right: [], bottom: [] },
        sizes: { left: [], right: [], bottom: [] },
        activeTab: {},
        zoneSizes: { ...DEFAULT_ZONE_SIZES },
      })
      loadLayoutIntoStore(serialized)
      expect(useLayoutStore.getState().zoneSizes).toEqual({ left: 0.4, right: 0.15, bottom: 0.3 })
    })

    it('falls back to defaults when loading legacy payload without zoneSizes', () => {
      loadLayoutIntoStore({
        panels: { left: [], right: [], bottom: [] },
        sizes: { left: [], right: [], bottom: [] },
        activeTab: {},
      })
      expect(useLayoutStore.getState().zoneSizes).toEqual(DEFAULT_ZONE_SIZES)
    })
  })
})
