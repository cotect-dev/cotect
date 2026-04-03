import type { PersistedLayout } from '@/services/windowManager'

export const MIN_SIDE_ZONE = 120
export const MIN_BOTTOM_ZONE = 80

export const NODE_WIDTH = 180
export const NODE_HEIGHT = 56
export const NODE_H_GAP = 32
export const NODE_V_GAP = 16

// Padding from the edges of the canvas visible area
export const CANVAS_PAD_Y = 56
export const CANVAS_MARGIN = 60

export const HIDDEN_DIRECTORIES = new Set([
  'node_modules', '__pycache__', 'dist', 'build', 'target', 'coverage',
  '.git', '.svn', '.hg', '.tmp', '.cache', '.next', '.nuxt',
  '.idea', '.vscode', '.DS_Store', '__MACOSX',
])

export const DEFAULT_MAIN_LAYOUT: PersistedLayout = {
  panels: { left: [['changes']], right: [['chat']], bottom: [['console']] },
  sizes: { left: [1], right: [1], bottom: [1] },
  activeTab: {},
}
