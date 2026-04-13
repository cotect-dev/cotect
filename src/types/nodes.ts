import type { Node } from '@xyflow/react'

/**
 * Display flags injected by flattenAndRender. Every node data type extends
 * this so the flags are typed at the point of use — no casts needed.
 */
export interface NodeDisplayFlags {
  __isFocused?: boolean
  __isCurrent?: boolean
  __isHidden?: boolean
  __columnIndex?: number
}

export interface FolderNodeData extends NodeDisplayFlags, Record<string, unknown> {
  label: string
  path: string
  isDirectory: true
  childCount?: number
}

export interface ImageNodeData extends NodeDisplayFlags, Record<string, unknown> {
  label: string
  filePath: string
  /** Base64-encoded image data (data URL) */
  dataUrl: string
}

export interface FileNodeData extends NodeDisplayFlags, Record<string, unknown> {
  label: string
  path: string
  isDirectory?: false
  isTestFile?: boolean
}

export interface CodeNodeData extends NodeDisplayFlags, Record<string, unknown> {
  label: string
  filePath: string
  code: string
  startLine: number
  endLine: number
}

export interface DiffNodeData extends NodeDisplayFlags, Record<string, unknown> {
  label: string
  filePath: string
  /** Whether this file is untracked/added (no HEAD content). */
  isNewFile: boolean
}

export type FolderNode = Node<FolderNodeData, 'folder'>
export type FileNode = Node<FileNodeData, 'file'>
export type CodeNode = Node<CodeNodeData, 'codeNode'>
export type ImageNode = Node<ImageNodeData, 'imageNode'>
export type DiffNode = Node<DiffNodeData, 'diff'>

export type AppNode = FolderNode | FileNode | CodeNode | ImageNode | DiffNode
