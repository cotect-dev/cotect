import { create } from 'zustand'

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

function findPanelPosition(panels: Record<PanelPosition, string[]>, panelId: string): PanelPosition | null {
  for (const pos of POSITIONS) {
    if (panels[pos].includes(panelId)) return pos
  }
  return null
}

function cloneState(state: { panels: Record<PanelPosition, string[]>; sizes: Record<PanelPosition, number[]> }) {
  return {
    panels: { left: [...state.panels.left], right: [...state.panels.right], bottom: [...state.panels.bottom] },
    sizes: { left: [...state.sizes.left], right: [...state.sizes.right], bottom: [...state.sizes.bottom] },
  }
}

function renormalize(sizes: number[]) {
  const total = sizes.reduce((a, b) => a + b, 0)
  return total > 0 ? sizes.map((s) => s / total) : sizes
}

interface LayoutState {
  panels: Record<PanelPosition, string[]>
  sizes: Record<PanelPosition, number[]>
  movePanel: (panelId: string, to: PanelPosition, insertIndex: number, neighborIndex?: number) => void
  resizePanels: (position: PanelPosition, index: number, ratio: number) => void
  addPanel: (panelId: string, position: PanelPosition) => void
  removePanel: (panelId: string) => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  panels: {
    left: ['explorer'],
    right: ['chat'],
    bottom: ['console'],
  },
  sizes: {
    left: [1],
    right: [1],
    bottom: [1],
  },
  movePanel: (panelId, to, insertIndex, neighborIndex) =>
    set((state) => {
      const from = findPanelPosition(state.panels, panelId)
      if (!from) return state

      const { panels, sizes } = cloneState(state)
      const oldIndex = panels[from].indexOf(panelId)

      panels[from].splice(oldIndex, 1)
      sizes[from].splice(oldIndex, 1)
      sizes[from] = renormalize(sizes[from])

      if (from === to && insertIndex === oldIndex) return state

      if (panels[to].length === 0) {
        panels[to].splice(insertIndex, 0, panelId)
        sizes[to] = [1]
      } else {
        const nIdx = neighborIndex ?? (insertIndex < panels[to].length ? insertIndex : panels[to].length - 1)
        const half = sizes[to][nIdx] / 2
        sizes[to][nIdx] = half
        panels[to].splice(insertIndex, 0, panelId)
        sizes[to].splice(insertIndex, 0, half)
      }

      return { panels, sizes }
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
      if (findPanelPosition(state.panels, panelId)) return state

      const { panels, sizes } = cloneState(state)

      if (panels[position].length === 0) {
        panels[position].push(panelId)
        sizes[position] = [1]
      } else {
        const lastIdx = panels[position].length - 1
        const half = sizes[position][lastIdx] / 2
        sizes[position][lastIdx] = half
        panels[position].push(panelId)
        sizes[position].push(half)
      }

      return { panels, sizes }
    }),
  removePanel: (panelId) =>
    set((state) => {
      const from = findPanelPosition(state.panels, panelId)
      if (!from) return state

      const { panels, sizes } = cloneState(state)
      const idx = panels[from].indexOf(panelId)
      panels[from].splice(idx, 1)
      sizes[from].splice(idx, 1)
      sizes[from] = renormalize(sizes[from])

      return { panels, sizes }
    }),
}))
