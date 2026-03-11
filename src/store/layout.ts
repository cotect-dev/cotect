import { create } from 'zustand'

const clampPanelWidth = (width: number) => {
  const min = window.innerWidth * 0.25
  const max = window.innerWidth * 0.5
  return Math.max(min, Math.min(max, width))
}

export type LayoutState = {
  rightPanelWidth: number
  setRightPanelWidth: (width: number) => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  rightPanelWidth: clampPanelWidth(288),
  setRightPanelWidth: (width) => {
    set({ rightPanelWidth: clampPanelWidth(width) })
  },
}))
