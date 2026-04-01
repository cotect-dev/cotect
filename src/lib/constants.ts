import type { PersistedLayout } from '@/services/windowManager'

export const MIN_SIDE_ZONE = 120
export const MIN_BOTTOM_ZONE = 80

export const NODE_WIDTH = 200
export const NODE_HEIGHT = 60
export const NODE_H_GAP = 40
export const NODE_V_GAP = 80

export const DEFAULT_MAIN_LAYOUT: PersistedLayout = {
  panels: { left: [['changes']], right: [['chat']], bottom: [['console']] },
  sizes: { left: [1], right: [1], bottom: [1] },
  activeTab: {},
}
