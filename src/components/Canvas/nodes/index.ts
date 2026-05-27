import { lazy, Suspense, createElement } from 'react'
import type { NodeTypes, NodeProps } from '@xyflow/react'
import FolderNode from './FolderNode'
import FileNode from './FileNode'
import ImageNode from './ImageNode'
import ImportRefNode from './ImportRefNode'
import type { CodeNode } from '@/types/nodes'

const LazyCodeNode = lazy(() => import('./CodeNode'))

function CodeNodeWrapper(props: NodeProps<CodeNode>) {
  return createElement(Suspense, { fallback: null }, createElement(LazyCodeNode, props))
}

export const nodeTypes: NodeTypes = {
  folder: FolderNode,
  file: FileNode,
  codeNode: CodeNodeWrapper,
  imageNode: ImageNode,
  importRef: ImportRefNode,
}
