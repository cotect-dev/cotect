import { create } from 'zustand'
import { createStoreWithHMR } from '@/lib/hmr'
import { saveLayout, type PersistedLayout } from '@/services/windowManager'

export type PanelPosition = 'left' | 'right' | 'bottom'

export interface PanelDefinition {
  id: string
  label: string
  defaultPosition: PanelPosition
  fallbackPosition?: PanelPosition
}

export type PanelGroup = 'git' | 'tools' | 'agent' | 'dev'

export const PANEL_DEFINITIONS: (PanelDefinition & { group: PanelGroup })[] = [
  { id: 'changes', label: 'Changes', defaultPosition: 'left', group: 'git' },
  { id: 'history', label: 'History', defaultPosition: 'left', group: 'git' },
  { id: 'branches', label: 'Branches', defaultPosition: 'left', group: 'git' },
  { id: 'chat', label: 'Chat', defaultPosition: 'right', group: 'tools' },
  { id: 'tasks', label: 'Tasks', defaultPosition: 'right', group: 'agent' },
  { id: 'settings', label: 'Settings', defaultPosition: 'right', group: 'agent' },
  // dev-group panels are toggled by hotkey, not the View menu (which lists only
  // git/tools/agent groups). console is opened with F12 in DEV builds.
  { id: 'console', label: 'Console', defaultPosition: 'bottom', fallbackPosition: 'right', group: 'dev' },
]

const POSITIONS: PanelPosition[] = ['left', 'right', 'bottom']

export function getPanelLabel(id: string): string {
  return PANEL_DEFINITIONS.find((d) => d.id === id)?.label ?? id
}

export function getEffectivePosition(panelId: string, isChildWindow: boolean): PanelPosition {
  const def = PANEL_DEFINITIONS.find((d) => d.id === panelId)
  if (!def) return 'left'
  if (isChildWindow && def.defaultPosition === 'bottom' && def.fallbackPosition) {
    return def.fallbackPosition
  }
  return def.defaultPosition
}

interface PanelLocation {
  position: PanelPosition
  groupIndex: number
  tabIndex: number
}

export interface ZoneSizes {
  left: number
  right: number
  bottom: number
}

export const DEFAULT_ZONE_SIZES: ZoneSizes = { left: 0.2, right: 0.2, bottom: 0.25 }

interface LayoutSlice {
  panels: Record<PanelPosition, string[][]>
  sizes: Record<PanelPosition, number[]>
  activeTab: Record<string, number>
  zoneSizes: ZoneSizes
}

function groupKey(group: string[]): string {
  return group[0] ?? ''
}

function renormalize(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0)
  return total > 0 ? sizes.map((s) => s / total) : sizes
}

function cloneSlice(state: LayoutSlice): LayoutSlice {
  const cloneZone = (zone: string[][]) => zone.map((g) => [...g])
  return {
    panels: { left: cloneZone(state.panels.left), right: cloneZone(state.panels.right), bottom: cloneZone(state.panels.bottom) },
    sizes: { left: [...state.sizes.left], right: [...state.sizes.right], bottom: [...state.sizes.bottom] },
    activeTab: { ...state.activeTab },
    zoneSizes: { ...state.zoneSizes },
  }
}

function findPanelLocation(panels: Record<PanelPosition, string[][]>, panelId: string): PanelLocation | null {
  for (const pos of POSITIONS) {
    for (let gi = 0; gi < panels[pos].length; gi++) {
      const ti = panels[pos][gi].indexOf(panelId)
      if (ti >= 0) return { position: pos, groupIndex: gi, tabIndex: ti }
    }
  }
  return null
}

function findGroupLocation(panels: Record<PanelPosition, string[][]>, panelId: string): { position: PanelPosition; groupIndex: number } | null {
  for (const pos of POSITIONS) {
    for (let gi = 0; gi < panels[pos].length; gi++) {
      if (panels[pos][gi].includes(panelId)) return { position: pos, groupIndex: gi }
    }
  }
  return null
}

function removePanelFromState(slice: LayoutSlice, loc: PanelLocation): void {
  const group = slice.panels[loc.position][loc.groupIndex]
  const oldKey = groupKey(group)
  group.splice(loc.tabIndex, 1)

  if (group.length === 0) {
    slice.panels[loc.position].splice(loc.groupIndex, 1)
    slice.sizes[loc.position].splice(loc.groupIndex, 1)
    slice.sizes[loc.position] = renormalize(slice.sizes[loc.position])
    delete slice.activeTab[oldKey]
  } else {
    const newKey = groupKey(group)
    if (newKey !== oldKey) {
      slice.activeTab[newKey] = slice.activeTab[oldKey] ?? 0
      delete slice.activeTab[oldKey]
    }
    if ((slice.activeTab[newKey] ?? 0) >= group.length) {
      slice.activeTab[newKey] = group.length - 1
    }
  }
}

function insertGroupIntoZone(slice: LayoutSlice, group: string[], position: PanelPosition, insertIndex: number, neighborIndex?: number): void {
  if (slice.panels[position].length === 0) {
    slice.panels[position].push(group)
    slice.sizes[position] = [1]
  } else {
    const nIdx = neighborIndex ?? (insertIndex < slice.panels[position].length ? insertIndex : slice.panels[position].length - 1)
    const half = slice.sizes[position][nIdx] / 2
    slice.sizes[position][nIdx] = half
    slice.panels[position].splice(insertIndex, 0, group)
    slice.sizes[position].splice(insertIndex, 0, half)
  }
}

export interface CrossWindowDrag {
  panelId: string
  panelIds: string[]
  position: PanelPosition
  insertIndex: number
  neighborIndex: number
}

interface LayoutState extends LayoutSlice {
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
  setZoneSizes: (partial: Partial<ZoneSizes>) => void
}

export const useLayoutStore = createStoreWithHMR(import.meta.hot, 'layout', () => create<LayoutState>((set) => ({
  panels: { left: [], right: [], bottom: [] },
  sizes: { left: [], right: [], bottom: [] },
  activeTab: {},
  zoneSizes: { ...DEFAULT_ZONE_SIZES },
  crossWindowDrag: null,

  setCrossWindowDrag: (drag) => set({ crossWindowDrag: drag }),

  movePanel: (panelId, to, insertIndex, neighborIndex) =>
    set((state) => {
      const loc = findPanelLocation(state.panels, panelId)
      if (!loc) return state
      const slice = cloneSlice(state)
      removePanelFromState(slice, loc)
      insertGroupIntoZone(slice, [panelId], to, insertIndex, neighborIndex)
      return slice
    }),

  movePanelToTab: (panelId, targetPanelId) =>
    set((state) => {
      if (panelId === targetPanelId) return state
      const srcLoc = findPanelLocation(state.panels, panelId)
      const tgtLoc = findGroupLocation(state.panels, targetPanelId)
      if (!srcLoc || !tgtLoc) return state
      if (srcLoc.position === tgtLoc.position && srcLoc.groupIndex === tgtLoc.groupIndex) return state

      const slice = cloneSlice(state)
      removePanelFromState(slice, srcLoc)

      const newTgt = findGroupLocation(slice.panels, targetPanelId)
      if (!newTgt) return state
      const targetGroup = slice.panels[newTgt.position][newTgt.groupIndex]
      const tgtKey = groupKey(targetGroup)
      targetGroup.push(panelId)
      slice.activeTab[tgtKey] = targetGroup.length - 1
      return slice
    }),

  moveGroup: (panelIds, to, insertIndex, neighborIndex) =>
    set((state) => {
      const slice = cloneSlice(state)
      let group: string[]
      const loc = findGroupLocation(state.panels, panelIds[0])

      if (loc) {
        if (loc.position === to && insertIndex === loc.groupIndex) return state
        group = slice.panels[loc.position].splice(loc.groupIndex, 1)[0]
        const oldKey = groupKey(group)
        slice.sizes[loc.position].splice(loc.groupIndex, 1)
        slice.sizes[loc.position] = renormalize(slice.sizes[loc.position])
        const newKey = groupKey(group)
        if (newKey !== oldKey && slice.activeTab[oldKey] !== undefined) {
          slice.activeTab[newKey] = slice.activeTab[oldKey]
          delete slice.activeTab[oldKey]
        }
      } else {
        group = [...panelIds]
      }

      insertGroupIntoZone(slice, group, to, insertIndex, neighborIndex)
      return slice
    }),

  moveGroupToTab: (panelIds, targetPanelId) =>
    set((state) => {
      const srcLoc = findGroupLocation(state.panels, panelIds[0])
      const tgtLoc = findGroupLocation(state.panels, targetPanelId)
      if (!srcLoc || !tgtLoc) return state
      if (srcLoc.position === tgtLoc.position && srcLoc.groupIndex === tgtLoc.groupIndex) return state

      const slice = cloneSlice(state)
      const srcGroup = slice.panels[srcLoc.position].splice(srcLoc.groupIndex, 1)[0]
      const srcKey = groupKey(srcGroup)
      slice.sizes[srcLoc.position].splice(srcLoc.groupIndex, 1)
      slice.sizes[srcLoc.position] = renormalize(slice.sizes[srcLoc.position])
      delete slice.activeTab[srcKey]

      const newTgt = findGroupLocation(slice.panels, targetPanelId)
      if (!newTgt) return state
      const targetGroup = slice.panels[newTgt.position][newTgt.groupIndex]
      const tgtKey = groupKey(targetGroup)
      targetGroup.push(...srcGroup)
      slice.activeTab[tgtKey] = targetGroup.length - 1
      return slice
    }),

  // Ratio-based pair adjustment — splits the (i, i+1) pair total by `ratio`.
  // Live drags use the pixel-based path in `DropZone.makeResizeHandler` instead.
  resizePanels: (position, index, ratio) =>
    set((state) => {
      if (index < 0 || index + 1 >= state.sizes[position].length) return state
      const sizes = { ...state.sizes, [position]: [...state.sizes[position]] }
      const total = sizes[position][index] + sizes[position][index + 1]
      sizes[position][index] = total * ratio
      sizes[position][index + 1] = total * (1 - ratio)
      return { sizes }
    }),

  addPanel: (panelId, position) =>
    set((state) => {
      if (findPanelLocation(state.panels, panelId)) return state
      const slice = cloneSlice(state)
      insertGroupIntoZone(slice, [panelId], position, slice.panels[position].length)
      return slice
    }),

  removePanel: (panelId) =>
    set((state) => {
      const loc = findPanelLocation(state.panels, panelId)
      if (!loc) return state
      const slice = cloneSlice(state)
      removePanelFromState(slice, loc)
      return slice
    }),

  setActiveTab: (key, index) =>
    set((state) => ({
      activeTab: { ...state.activeTab, [key]: index },
    })),

  setZoneSizes: (partial) =>
    set((state) => ({
      zoneSizes: { ...state.zoneSizes, ...partial },
    })),
})))

export function getSerializableLayout(): PersistedLayout {
  const { panels, sizes, activeTab, zoneSizes } = useLayoutStore.getState()
  return { panels, sizes, activeTab, zoneSizes }
}

export function loadLayoutIntoStore(saved: PersistedLayout): void {
  useLayoutStore.setState({
    panels: saved.panels,
    sizes: saved.sizes,
    activeTab: saved.activeTab,
    zoneSizes: saved.zoneSizes ?? { ...DEFAULT_ZONE_SIZES },
  })
}

let persistUnsub: (() => void) | null = null

export function startLayoutPersistence(windowId: string): void {
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
