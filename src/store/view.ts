import { create } from 'zustand'
import { createStoreWithHMR } from '@/lib/hmr'

/**
 * Top-level view modes selectable via the 1/2/3 keys:
 *  - `files`    : the Miller-column file browser (default)
 *  - `graph`    : tree-sitter import graph
 *  - `settings` : LLM provider configuration
 *
 * Layout panels (Changes/History/Chat/etc.) are only overlaid on the `files`
 * view; the other two are full-bleed.
 */
export type ViewMode = 'files' | 'graph' | 'settings'

export const VIEW_MODES: ViewMode[] = ['files', 'graph', 'settings']

interface ViewState {
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
}

export const useViewStore = createStoreWithHMR(import.meta.hot, 'view', () => create<ViewState>((set) => ({
  viewMode: 'files',
  setViewMode: (mode) => set({ viewMode: mode }),
})))
