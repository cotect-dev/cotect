import type { PersistedLayout } from '@/types/layout'

export const MIN_SIDE_ZONE = 120
export const MIN_BOTTOM_ZONE = 80

export const MIN_SIBLING_PANEL = 40

export const DEFAULT_MAIN_LAYOUT: PersistedLayout = {
  panels: { left: [['changes']], right: [], bottom: [] },
  sizes: { left: [1], right: [], bottom: [] },
  activeTab: {},
}
