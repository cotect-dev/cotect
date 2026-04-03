import type { Node } from '@xyflow/react'

export interface FolderNodeData extends Record<string, unknown> {
  label: string
  path: string
  isDirectory: true
}

export interface FileNodeData extends Record<string, unknown> {
  label: string
  path: string
  isDirectory?: false
  isImport?: boolean
  isTestFile?: boolean
  declarationCount?: number
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

export interface CodeNodeData extends Record<string, unknown> {
  label: string
  filePath: string
  code: string
  startLine: number
  endLine: number
}

export type FolderNode = Node<FolderNodeData, 'folder'>
export type FileNode = Node<FileNodeData, 'file'>
export type FunctionNode = Node<FunctionNodeData, 'functionNode'>
export type ClassNode = Node<ClassNodeData, 'classNode'>
export type CodeNode = Node<CodeNodeData, 'codeNode'>

export type AppNode = FolderNode | FileNode | FunctionNode | ClassNode | CodeNode
