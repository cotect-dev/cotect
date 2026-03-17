import { create } from 'zustand'

export type PanelPosition = 'left' | 'right' | 'bottom'

interface LayoutState {
  panels: Record<PanelPosition, string[]>
  movePanel: (panelId: string, to: PanelPosition, insertIndex: number) => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  panels: {
    left: ['area-1'],
    right: ['area-2'],
    bottom: ['area-3'],
  },
  movePanel: (panelId, to, insertIndex) =>
    set((state) => {
      let from: PanelPosition | null = null
      for (const pos of ['left', 'right', 'bottom'] as PanelPosition[]) {
        if (state.panels[pos].includes(panelId)) {
          from = pos
          break
        }
      }
      if (!from) return state

      const panels = {
        left: [...state.panels.left],
        right: [...state.panels.right],
        bottom: [...state.panels.bottom],
      }

      const oldIndex = panels[from].indexOf(panelId)
      panels[from].splice(oldIndex, 1)

      let idx = insertIndex
      if (from === to && oldIndex < insertIndex) idx--
      if (from === to && idx === oldIndex) return state

      panels[to].splice(idx, 0, panelId)
      return { panels }
    }),
}))
