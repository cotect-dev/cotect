import { create } from 'zustand'
import { createStoreWithHMR } from '@/lib/hmr'

interface BrowserState {
  rootPath: string
  openRoot: (path: string) => void
}

export const useBrowserStore = createStoreWithHMR(import.meta.hot, 'browser', () =>
  create<BrowserState>((set) => ({
    rootPath: '',
    openRoot: (path) => set({ rootPath: path }),
  })),
)
