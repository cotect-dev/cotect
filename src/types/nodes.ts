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
  isImport?: boolean
  isTestFile?: boolean
  declarationCount?: number
}

export interface CodeNodeData extends Record<string, unknown> {
  label: string
  filePath: string
  code: string
  startLine: number
  endLine: number
}

export interface FunctionNodeData extends Record<string, unknown> {
  label: string
  kind: 'function'
  startLine: number
  endLine: number
  isMethod?: boolean
}

export interface ClassNodeData extends Record<string, unknown> {
  label: string
  kind: 'class'
  startLine: number
  endLine: number
}

export type FolderNode = Node<FolderNodeData, 'folder'>
export type FileNode = Node<FileNodeData, 'file'>
export type CodeNode = Node<CodeNodeData, 'codeNode'>
export type ImageNode = Node<ImageNodeData, 'imageNode'>
export type FunctionNode = Node<FunctionNodeData, 'functionNode'>
export type ClassNode = Node<ClassNodeData, 'classNode'>

export type AppNode = FolderNode | FileNode | CodeNode | ImageNode | FunctionNode | ClassNode
