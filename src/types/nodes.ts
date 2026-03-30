import type { Node } from '@xyflow/react'

export interface FolderNodeData {
  label: string
  path: string
  isDirectory: true
}

export interface FileNodeData {
  label: string
  path: string
  isDirectory?: false
  isImport?: boolean
  declarationCount?: number
}

export interface FunctionNodeData {
  label: string
  kind: 'function'
  startLine: number
  endLine: number
  isMethod?: boolean
}

export interface ClassNodeData {
  label: string
  kind: 'class'
  startLine: number
  endLine: number
}

export type FolderNode = Node<FolderNodeData, 'folder'>
export type FileNode = Node<FileNodeData, 'file'>
export type FunctionNode = Node<FunctionNodeData, 'functionNode'>
export type ClassNode = Node<ClassNodeData, 'classNode'>

export type AppNode = FolderNode | FileNode | FunctionNode | ClassNode
