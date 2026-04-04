import type { NodeTypes } from '@xyflow/react'
import FolderNode from './FolderNode'
import FileNode from './FileNode'
import CodeNode from './CodeNode'
import ImageNode from './ImageNode'

export const nodeTypes: NodeTypes = {
  folder: FolderNode,
  file: FileNode,
  codeNode: CodeNode,
  imageNode: ImageNode,
}

/**
 * Extract the internal display flags injected by flattenAndRender.
 * Shared across all node components to avoid repeating the same cast pattern.
 */
export function getNodeFlags(data: Record<string, unknown>): {
  isFocused: boolean
  isCurrent: boolean
  isHidden: boolean
} {
  return {
    isFocused: (data.__isFocused as boolean) ?? false,
    isCurrent: (data.__isCurrent as boolean) ?? true,
    isHidden: (data.__isHidden as boolean) ?? false,
  }
}

/**
 * Returns the standard opacity class string for a node based on its flags.
 */
export function getNodeOpacity(flags: { isCurrent: boolean; isHidden: boolean }): string {
  if (flags.isHidden) return 'opacity-30'
  if (!flags.isCurrent) return 'opacity-50'
  return ''
}
