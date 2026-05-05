import type { PersistedLayout } from '@/services/windowManager'

export const MIN_SIDE_ZONE = 120
export const MIN_BOTTOM_ZONE = 80

// Floor for either side of a sibling resize. Smaller than MIN_SIDE_ZONE
// on purpose — collapses against a neighbor, not the window edge.
export const MIN_SIBLING_PANEL = 40

export const NODE_WIDTH = 180
export const NODE_HEIGHT = 56
export const NODE_H_GAP = 32
export const NODE_V_GAP = 16
export const NODE_V_GAP_SMALL = 4

// Padding from the edges of the canvas visible area. CANVAS_PAD_Y must equal
// CANVAS_MARGIN — the column-switch effect places the viewport at PAD_Y, while
// the focused-node visibility clamp uses MARGIN; if they differ, the next
// focus change re-triggers a Y shift of (MARGIN − PAD_Y) pixels.
export const CANVAS_MARGIN = 60
export const CANVAS_PAD_Y = CANVAS_MARGIN

// Maximum byte size for image previews (base64-encoded into a data URL).
// Images larger than this will show a placeholder instead of loading.
export const IMAGE_PREVIEW_MAX_BYTES = 5 * 1024 * 1024 // 5 MB

export const HIDDEN_DIRECTORIES = new Set([
  'node_modules', '__pycache__', 'dist', 'build', 'target', 'coverage',
  '.git', '.svn', '.hg', '.tmp', '.cache', '.next', '.nuxt',
  '.idea', '.vscode', '.DS_Store', '__MACOSX',
])

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico', '.avif',
])

export function isImageFile(name: string): boolean {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

export function getImageMimeType(name: string): string {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  switch (ext) {
    case '.png': return 'image/png'
    case '.jpg': case '.jpeg': return 'image/jpeg'
    case '.gif': return 'image/gif'
    case '.bmp': return 'image/bmp'
    case '.webp': return 'image/webp'
    case '.svg': return 'image/svg+xml'
    case '.ico': return 'image/x-icon'
    case '.avif': return 'image/avif'
    default: return 'application/octet-stream'
  }
}

export const DEFAULT_MAIN_LAYOUT: PersistedLayout = {
  panels: { left: [['changes']], right: [['chat']], bottom: [] },
  sizes: { left: [1], right: [1], bottom: [] },
  activeTab: {},
}
