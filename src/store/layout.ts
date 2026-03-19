import { create } from 'zustand'

export type PanelPosition = 'left' | 'right' | 'bottom'

interface LayoutState {
  panels: Record<PanelPosition, string[]>
  sizes: Record<PanelPosition, number[]>
  movePanel: (panelId: string, to: PanelPosition, insertIndex: number, neighborIndex?: number) => void
  resizePanels: (position: PanelPosition, index: number, ratio: number) => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  panels: {
    left: ['area-1'],
    right: ['area-2'],
    bottom: ['area-3'],
  },
  sizes: {
    left: [1],
    right: [1],
    bottom: [1],
  },
  movePanel: (panelId, to, insertIndex, neighborIndex) =>
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
      const sizes = {
        left: [...state.sizes.left],
        right: [...state.sizes.right],
        bottom: [...state.sizes.bottom],
      }

      const oldIndex = panels[from].indexOf(panelId)

      // Remove from source
      panels[from].splice(oldIndex, 1)
      sizes[from].splice(oldIndex, 1)
      // Renormalize source sizes
      const srcTotal = sizes[from].reduce((a, b) => a + b, 0)
      if (srcTotal > 0) {
        sizes[from] = sizes[from].map((s) => s / srcTotal)
      }

      // insertIndex is already in visible (post-removal) space
      const idx = insertIndex
      if (from === to && idx === oldIndex) return state

      // The new panel takes half the space of its neighbor, or full if zone is empty
      if (panels[to].length === 0) {
        panels[to].splice(idx, 0, panelId)
        sizes[to] = [1]
      } else {
        // Use the provided neighborIndex (the hovered panel), or fall back to insert position
        const nIdx = neighborIndex ?? (idx < panels[to].length ? idx : panels[to].length - 1)
        const neighborSize = sizes[to][nIdx]
        const half = neighborSize / 2
        sizes[to][nIdx] = half
        panels[to].splice(idx, 0, panelId)
        sizes[to].splice(idx, 0, half)
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
}))
