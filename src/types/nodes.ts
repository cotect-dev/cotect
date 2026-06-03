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
  headOverride?: string | null
  readOnly?: boolean
  commitHash?: string
  /** Present when this node is a read-only commit-range review diff. */
  review?: { filePath: string } // repo-relative path under review
}

export interface ImportRefItem {
  label: string
  resolvedPath: string
  kind: 'import' | 'imported-by'
  importedNames?: string[]
  /** 1-based line in `resolvedPath` to scroll to when the pill is clicked. */
  targetLine?: number
}

export interface ImportRefNodeData extends NodeDisplayFlags, Record<string, unknown> {
  /** All ref pills to render on this visual line, in order. */
  items: ImportRefItem[]
  /** 1-based source line number (used for node ID). */
  line: number
  /** Whether the leading connector line should be shown. */
  showConnector: boolean
}

export type FolderNode = Node<FolderNodeData, 'folder'>
export type FileNode = Node<FileNodeData, 'file'>
export type CodeNode = Node<CodeNodeData, 'codeNode'>
export type ImageNode = Node<ImageNodeData, 'imageNode'>
export type ImportRefNode = Node<ImportRefNodeData, 'importRef'>

export type AppNode = FolderNode | FileNode | CodeNode | ImageNode | ImportRefNode
