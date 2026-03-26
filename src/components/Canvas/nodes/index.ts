import type { NodeTypes } from '@xyflow/react'
import FolderNode from './FolderNode'
import FileNode from './FileNode'
import FunctionNode from './FunctionNode'
import ClassNode from './ClassNode'

export const nodeTypes: NodeTypes = {
  folder: FolderNode,
  file: FileNode,
  functionNode: FunctionNode,
  classNode: ClassNode,
}
