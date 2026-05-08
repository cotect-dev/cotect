import type { NodeTypes } from '@xyflow/react'
import FolderNode from './FolderNode'
import FileNode from './FileNode'
import CodeNode from './CodeNode'
import ImageNode from './ImageNode'
import ImportRefNode from './ImportRefNode'

export { getNodeFlags, getNodeOpacity } from './nodeUtils'
export type { ResolvedNodeFlags } from './nodeUtils'

export const nodeTypes: NodeTypes = {
  folder: FolderNode,
  file: FileNode,
  codeNode: CodeNode,
  imageNode: ImageNode,
  importRef: ImportRefNode,
}
