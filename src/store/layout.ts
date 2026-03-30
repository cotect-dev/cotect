import { create } from 'zustand'
import { saveLayout, type PersistedLayout } from '@/services/windowManager'

export type PanelPosition = 'left' | 'right' | 'bottom'

export interface PanelDefinition {
  id: string
  label: string
  defaultPosition: PanelPosition
}

export const PANEL_DEFINITIONS: PanelDefinition[] = [
  { id: 'explorer', label: 'Explorer', defaultPosition: 'left' },
  { id: 'chat', label: 'Chat', defaultPosition: 'right' },
  { id: 'properties', label: 'Properties', defaultPosition: 'right' },
  { id: 'console', label: 'Console', defaultPosition: 'bottom' },
  { id: 'timeline', label: 'Timeline', defaultPosition: 'bottom' },
  { id: 'terminal', label: 'Terminal', defaultPosition: 'bottom' },
]

const POSITIONS: PanelPosition[] = ['left', 'right', 'bottom']

export function getPanelLabel(id: string): string {
  return PANEL_DEFINITIONS.find((d) => d.id === id)?.label ?? id
}

interface PanelLocation {
  position: PanelPosition
  groupIndex: number
  tabIndex: number
}

function findPanel(panels: Record<PanelPosition, string[][]>, panelId: string): PanelLocation | null {
  for (const pos of POSITIONS) {
    for (let gi = 0; gi < panels[pos].length; gi++) {
      const ti = panels[pos][gi].indexOf(panelId)
      if (ti >= 0) return { position: pos, groupIndex: gi, tabIndex: ti }
    }
  }
  return null
}

function findGroup(panels: Record<PanelPosition, string[][]>, panelId: string): { position: PanelPosition; groupIndex: number } | null {
  for (const pos of POSITIONS) {
    for (let gi = 0; gi < panels[pos].length; gi++) {
      if (panels[pos][gi].includes(panelId)) return { position: pos, groupIndex: gi }
    }
  }
  return null
}

function cloneState(state: { panels: Record<PanelPosition, string[][]>; sizes: Record<PanelPosition, number[]>; activeTab: Record<string, number> }) {
  return {
    panels: {
      left: state.panels.left.map((g) => [...g]),
      right: state.panels.right.map((g) => [...g]),
      bottom: state.panels.bottom.map((g) => [...g]),
    },
    sizes: { left: [...state.sizes.left], right: [...state.sizes.right], bottom: [...state.sizes.bottom] },
    activeTab: { ...state.activeTab },
  }
}

function renormalize(sizes: number[]) {
  const total = sizes.reduce((a, b) => a + b, 0)
  return total > 0 ? sizes.map((s) => s / total) : sizes
}

function groupKey(group: string[]): string {
  return group[0] ?? ''
}

export interface CrossWindowDrag {
  panelId: string
  panelIds: string[]
  position: PanelPosition
}

interface LayoutState {
  panels: Record<PanelPosition, string[][]>
  sizes: Record<PanelPosition, number[]>
  activeTab: Record<string, number>
  crossWindowDrag: CrossWindowDrag | null
  movePanel: (panelId: string, to: PanelPosition, insertIndex: number, neighborIndex?: number) => void
  movePanelToTab: (panelId: string, targetPanelId: string) => void
  moveGroup: (panelIds: string[], to: PanelPosition, insertIndex: number, neighborIndex?: number) => void
  moveGroupToTab: (panelIds: string[], targetPanelId: string) => void
  resizePanels: (position: PanelPosition, index: number, ratio: number) => void
  addPanel: (panelId: string, position: PanelPosition) => void
  removePanel: (panelId: string) => void
  setActiveTab: (groupKey: string, index: number) => void
  setCrossWindowDrag: (drag: CrossWindowDrag | null) => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  panels: {
    left: [],
    right: [],
    bottom: [],
  },
  sizes: {
    left: [],
    right: [],
    bottom: [],
  },
  activeTab: {},
  crossWindowDrag: null,

  setCrossWindowDrag: (drag) => set({ crossWindowDrag: drag }),

  movePanel: (panelId, to, insertIndex, neighborIndex) =>
    set((state) => {
      const loc = findPanel(state.panels, panelId)
      if (!loc) return state

      const { panels, sizes, activeTab } = cloneState(state)

      // Remove panel from its current group
      const oldGroup = panels[loc.position][loc.groupIndex]
      const oldKey = groupKey(oldGroup)
      oldGroup.splice(loc.tabIndex, 1)

      // Fix active tab for old group
      if (oldGroup.length === 0) {
        panels[loc.position].splice(loc.groupIndex, 1)
        sizes[loc.position].splice(loc.groupIndex, 1)
        sizes[loc.position] = renormalize(sizes[loc.position])
        delete activeTab[oldKey]
      } else {
        const newKey = groupKey(oldGroup)
        if (newKey !== oldKey) {
          activeTab[newKey] = activeTab[oldKey] ?? 0
          delete activeTab[oldKey]
        }
        if ((activeTab[newKey] ?? 0) >= oldGroup.length) {
          activeTab[newKey] = oldGroup.length - 1
        }
      }

      // Insert as new group at target position
      const newGroup = [panelId]
      if (panels[to].length === 0) {
        panels[to].push(newGroup)
        sizes[to] = [1]
      } else {
        const nIdx = neighborIndex ?? (insertIndex < panels[to].length ? insertIndex : panels[to].length - 1)
        const half = sizes[to][nIdx] / 2
        sizes[to][nIdx] = half
        panels[to].splice(insertIndex, 0, newGroup)
        sizes[to].splice(insertIndex, 0, half)
      }

      return { panels, sizes, activeTab }
    }),

  movePanelToTab: (panelId, targetPanelId) =>
    set((state) => {
      if (panelId === targetPanelId) return state
      const srcLoc = findPanel(state.panels, panelId)
      const tgtLoc = findGroup(state.panels, targetPanelId)
      if (!srcLoc || !tgtLoc) return state

      // Already in the same group
      if (srcLoc.position === tgtLoc.position && srcLoc.groupIndex === tgtLoc.groupIndex) return state

      const { panels, sizes, activeTab } = cloneState(state)

      // Remove panel from source group
      const oldGroup = panels[srcLoc.position][srcLoc.groupIndex]
      const oldKey = groupKey(oldGroup)
      oldGroup.splice(srcLoc.tabIndex, 1)

      if (oldGroup.length === 0) {
        panels[srcLoc.position].splice(srcLoc.groupIndex, 1)
        sizes[srcLoc.position].splice(srcLoc.groupIndex, 1)
        sizes[srcLoc.position] = renormalize(sizes[srcLoc.position])
        delete activeTab[oldKey]
      } else {
        const newKey = groupKey(oldGroup)
        if (newKey !== oldKey) {
          activeTab[newKey] = activeTab[oldKey] ?? 0
          delete activeTab[oldKey]
        }
        if ((activeTab[newKey] ?? 0) >= oldGroup.length) {
          activeTab[newKey] = oldGroup.length - 1
        }
      }

      // Re-find target after removal (indices may have shifted)
      const newTgtLoc = findGroup(panels, targetPanelId)
      if (!newTgtLoc) return state

      const targetGroup = panels[newTgtLoc.position][newTgtLoc.groupIndex]
      const tgtKey = groupKey(targetGroup)
      targetGroup.push(panelId)
      activeTab[tgtKey] = targetGroup.length - 1

      return { panels, sizes, activeTab }
    }),

  moveGroup: (panelIds, to, insertIndex, neighborIndex) =>
    set((state) => {
      // Find the group that contains these panels
      const loc = findGroup(state.panels, panelIds[0])
      if (!loc) return state

      const { panels, sizes, activeTab } = cloneState(state)

      // Remove entire group
      const group = panels[loc.position].splice(loc.groupIndex, 1)[0]
      const oldKey = groupKey(group)
      sizes[loc.position].splice(loc.groupIndex, 1)
      sizes[loc.position] = renormalize(sizes[loc.position])

      // Check for no-op
      if (loc.position === to && insertIndex === loc.groupIndex) {
        return state
      }

      // Insert group at target
      if (panels[to].length === 0) {
        panels[to].push(group)
        sizes[to] = [1]
      } else {
        const nIdx = neighborIndex ?? (insertIndex < panels[to].length ? insertIndex : panels[to].length - 1)
        const half = sizes[to][nIdx] / 2
        sizes[to][nIdx] = half
        panels[to].splice(insertIndex, 0, group)
        sizes[to].splice(insertIndex, 0, half)
      }

      // Migrate activeTab key if group key changed
      const newKey = groupKey(group)
      if (newKey !== oldKey && activeTab[oldKey] !== undefined) {
        activeTab[newKey] = activeTab[oldKey]
        delete activeTab[oldKey]
      }

      return { panels, sizes, activeTab }
    }),

  moveGroupToTab: (panelIds, targetPanelId) =>
    set((state) => {
      const srcLoc = findGroup(state.panels, panelIds[0])
      const tgtLoc = findGroup(state.panels, targetPanelId)
      if (!srcLoc || !tgtLoc) return state
      if (srcLoc.position === tgtLoc.position && srcLoc.groupIndex === tgtLoc.groupIndex) return state

      const { panels, sizes, activeTab } = cloneState(state)

      // Remove source group
      const srcGroup = panels[srcLoc.position].splice(srcLoc.groupIndex, 1)[0]
      const srcKey = groupKey(srcGroup)
      sizes[srcLoc.position].splice(srcLoc.groupIndex, 1)
      sizes[srcLoc.position] = renormalize(sizes[srcLoc.position])
      delete activeTab[srcKey]

      // Re-find target
      const newTgtLoc = findGroup(panels, targetPanelId)
      if (!newTgtLoc) return state

      const targetGroup = panels[newTgtLoc.position][newTgtLoc.groupIndex]
      const tgtKey = groupKey(targetGroup)
      targetGroup.push(...srcGroup)
      activeTab[tgtKey] = targetGroup.length - 1

      return { panels, sizes, activeTab }
    }),

  resizePanels: (position, index, ratio) =>
    set((state) => {
      const sizes = { ...state.sizes, [position]: [...state.sizes[position]] }
      const a = sizes[position][index]
      const b = sizes[position][index + 1]
      const total = a + b
      sizes[position][index] = total * ratio
      sizes[position][index + 1] = total * (1 - ratio)
      return { sizes }
    }),

  addPanel: (panelId, position) =>
    set((state) => {
      if (findPanel(state.panels, panelId)) return state

      const { panels, sizes } = cloneState(state)

      if (panels[position].length === 0) {
        panels[position].push([panelId])
        sizes[position] = [1]
      } else {
        const lastIdx = panels[position].length - 1
        const half = sizes[position][lastIdx] / 2
        sizes[position][lastIdx] = half
        panels[position].push([panelId])
        sizes[position].push(half)
      }

      return { panels, sizes }
    }),

  removePanel: (panelId) =>
    set((state) => {
      const loc = findPanel(state.panels, panelId)
      if (!loc) return state

      const { panels, sizes, activeTab } = cloneState(state)
      const group = panels[loc.position][loc.groupIndex]
      const key = groupKey(group)

      group.splice(loc.tabIndex, 1)

      if (group.length === 0) {
        panels[loc.position].splice(loc.groupIndex, 1)
        sizes[loc.position].splice(loc.groupIndex, 1)
        sizes[loc.position] = renormalize(sizes[loc.position])
        delete activeTab[key]
      } else {
        const newKey = groupKey(group)
        if (newKey !== key) {
          activeTab[newKey] = activeTab[key] ?? 0
          delete activeTab[key]
        }
        if ((activeTab[newKey] ?? 0) >= group.length) {
          activeTab[newKey] = group.length - 1
        }
      }

      return { panels, sizes, activeTab }
    }),

  setActiveTab: (key, index) =>
    set((state) => ({
      activeTab: { ...state.activeTab, [key]: index },
    })),
}))

// --- Persistence helpers ---

export function getSerializableLayout(): PersistedLayout {
  const { panels, sizes, activeTab } = useLayoutStore.getState()
  return { panels, sizes, activeTab }
}

export function loadLayoutIntoStore(saved: PersistedLayout): void {
  useLayoutStore.setState({
    panels: saved.panels,
    sizes: saved.sizes,
    activeTab: saved.activeTab,
  })
}

let persistUnsub: (() => void) | null = null

export function startLayoutPersistence(windowId: string): void {
  // Avoid double-subscribe
  if (persistUnsub) persistUnsub()

  let timer: ReturnType<typeof setTimeout> | null = null
  persistUnsub = useLayoutStore.subscribe(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      saveLayout(windowId, getSerializableLayout())
    }, 300)
  })
}

export function stopLayoutPersistence(): void {
  if (persistUnsub) {
    persistUnsub()
    persistUnsub = null
  }
}
