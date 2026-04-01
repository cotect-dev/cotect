import type { PersistedLayout } from '@/services/windowManager'

// Layout zone constraints
export const MIN_SIDE_ZONE = 120
export const MIN_BOTTOM_ZONE = 80

// Canvas node dimensions
export const NODE_WIDTH = 200
export const NODE_HEIGHT = 60
export const NODE_H_GAP = 40
export const NODE_V_GAP = 80

// Default panel layout for the main window
export const DEFAULT_MAIN_LAYOUT: PersistedLayout = {
  panels: { left: [['explorer']], right: [['chat']], bottom: [['console']] },
  sizes: { left: [1], right: [1], bottom: [1] },
  activeTab: {},
}
