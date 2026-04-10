import type { Node } from '@xyflow/react'

export interface FolderNodeData extends Record<string, unknown> {
  label: string
  path: string
  isDirectory: true
  childCount?: number
}

export interface ImageNodeData extends Record<string, unknown> {
  label: string
  filePath: string
  /** Base64-encoded image data (data URL) */
  dataUrl: string
}

export interface FileNodeData extends Record<string, unknown> {
  label: string
  path: string
  isDirectory?: false
  isTestFile?: boolean
}

export interface CodeNodeData extends Record<string, unknown> {
  label: string
  filePath: string
  code: string
  startLine: number
  endLine: number
}

export type FolderNode = Node<FolderNodeData, 'folder'>
export type FileNode = Node<FileNodeData, 'file'>
export type CodeNode = Node<CodeNodeData, 'codeNode'>
export type ImageNode = Node<ImageNodeData, 'imageNode'>

export type AppNode = FolderNode | FileNode | CodeNode | ImageNode
