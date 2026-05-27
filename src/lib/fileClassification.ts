export function isTestFile(name: string): boolean {
  const lower = name.toLowerCase()
  if (/\.(test|spec)\.\w+$/.test(lower)) return true
  if (/[_-]test\.\w+$/.test(lower)) return true
  if (/^tests?\.\w+$/.test(lower)) return true
  if (/^(jest|vitest|karma|cypress|playwright)[.-]/.test(lower)) return true
  return false
}

export const IMAGE_PREVIEW_MAX_BYTES = 5 * 1024 * 1024 // 5 MB

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
