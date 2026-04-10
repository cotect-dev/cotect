import type { NodeTypes } from '@xyflow/react'
import type { NodeDisplayFlags } from '@/types/nodes'
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

export interface ResolvedNodeFlags {
  isFocused: boolean
  isCurrent: boolean
  isHidden: boolean
}

/**
 * Extract the internal display flags injected by flattenAndRender.
 * Accepts any node data type since every NodeData extends NodeDisplayFlags.
 */
export function getNodeFlags(data: NodeDisplayFlags): ResolvedNodeFlags {
  return {
    isFocused: data.__isFocused ?? false,
    isCurrent: data.__isCurrent ?? true,
    isHidden: data.__isHidden ?? false,
  }
}

/**
 * Returns the standard opacity class string for a node based on its flags.
 */
export function getNodeOpacity(flags: Pick<ResolvedNodeFlags, 'isCurrent' | 'isHidden'>): string {
  if (flags.isHidden) return 'opacity-30'
  if (!flags.isCurrent) return 'opacity-50'
  return ''
}
