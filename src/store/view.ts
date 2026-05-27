import { create } from 'zustand'
import { createStoreWithHMR } from '@/lib/hmr'

export type ViewMode = 'files' | 'graph' | 'settings'

export const VIEW_MODES: ViewMode[] = ['files', 'graph', 'settings']

interface ViewState {
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
}

export const useViewStore = createStoreWithHMR(import.meta.hot, 'view', () =>
  create<ViewState>((set) => ({
    viewMode: 'files',
    setViewMode: (mode) => set({ viewMode: mode }),
  })),
)
