import type { PersistedLayout } from '@/types/layout'

export const MIN_SIDE_ZONE = 120
export const MIN_BOTTOM_ZONE = 80

export const MIN_SIBLING_PANEL = 40

export const NODE_WIDTH = 180
export const NODE_HEIGHT = 56
export const NODE_H_GAP = 32
export const NODE_V_GAP = 16
export const NODE_V_GAP_SMALL = 4

export const CANVAS_MARGIN = 60

export const IMAGE_PREVIEW_MAX_BYTES = 5 * 1024 * 1024 // 5 MB

export const HIDDEN_DIRECTORIES = new Set([
  'node_modules',
  '__pycache__',
  'dist',
  'build',
  'target',
  'coverage',
  '.git',
  '.svn',
  '.hg',
  '.tmp',
  '.cache',
  '.next',
  '.nuxt',
  '.idea',
  '.vscode',
  '__MACOSX',
])

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp',
  '.svg',
  '.ico',
  '.avif',
])

export function isMarkdownFile(name: string): boolean {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return ext === '.md' || ext === '.mdx'
}

export function isImageFile(name: string): boolean {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

export function getImageMimeType(name: string): string {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  switch (ext) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.bmp':
      return 'image/bmp'
    case '.webp':
      return 'image/webp'
    case '.svg':
      return 'image/svg+xml'
    case '.ico':
      return 'image/x-icon'
    case '.avif':
      return 'image/avif'
    default:
      return 'application/octet-stream'
  }
}

export const DEFAULT_MAIN_LAYOUT: PersistedLayout = {
  panels: { left: [['changes']], right: [['tasks']], bottom: [] },
  sizes: { left: [1], right: [1], bottom: [] },
  activeTab: {},
}
