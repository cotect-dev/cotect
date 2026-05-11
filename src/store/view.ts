import { create } from 'zustand'
import { createStoreWithHMR } from '@/lib/hmr'

/**
 * Top-level view modes selectable via the 1/2/3/4 keys:
 *  - `files`     : the Miller-column file browser (default)
 *  - `graph`     : tree-sitter import graph
 *  - `settings`  : LLM provider configuration
 *  - `analytics` : usage / spend / latency dashboard
 *
 * Layout panels (Changes/History/Tasks/etc.) are only overlaid on the `files`
 * view; the other three are full-bleed.
 */
export type ViewMode = 'files' | 'graph' | 'settings' | 'analytics'

export const VIEW_MODES: ViewMode[] = ['files', 'graph', 'settings', 'analytics']

interface ViewState {
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
}

export const useViewStore = createStoreWithHMR(import.meta.hot, 'view', () => create<ViewState>((set) => ({
  viewMode: 'files',
  setViewMode: (mode) => set({ viewMode: mode }),
})))
