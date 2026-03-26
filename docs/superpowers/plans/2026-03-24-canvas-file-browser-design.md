# Canvas File Browser with Tree-Sitter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display folder/file structure on the ReactFlow canvas as a navigable tree, with tree-sitter parsing to show functions/classes inside files and import edges between them.

**Architecture:** The canvas store gains a navigation model (current path + view mode). A filesystem service reads directories via Neutralino. A tree-sitter service (web-tree-sitter WASM) parses JS/TS files to extract declarations and imports. Custom ReactFlow nodes render folders, files, functions, and classes. A breadcrumb bar overlays the canvas for navigation. A layout engine positions nodes in a hierarchical tree.

**Tech Stack:** web-tree-sitter (WASM), tree-sitter-typescript/tree-sitter-javascript grammars, @xyflow/react, Neutralino.filesystem, Zustand

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/services/filesystem.ts` | Read directories via Neutralino.filesystem, return typed entries |
| `src/services/treesitter.ts` | Initialize web-tree-sitter WASM, parse files, extract declarations + imports |
| `src/services/treesitter-queries.ts` | Tree-sitter query strings for JS/TS (functions, classes, imports), extensible per language |
| `src/store/browser.ts` | Navigation state: current path, view mode, breadcrumb stack, loading state |
| `src/components/Canvas/Breadcrumbs.tsx` | Breadcrumb bar overlay on the canvas |
| `src/components/Canvas/nodes/FolderNode.tsx` | Custom ReactFlow node for folders |
| `src/components/Canvas/nodes/FileNode.tsx` | Custom ReactFlow node for files |
| `src/components/Canvas/nodes/FunctionNode.tsx` | Custom ReactFlow node for functions |
| `src/components/Canvas/nodes/ClassNode.tsx` | Custom ReactFlow node for classes (parent of methods) |
| `src/components/Canvas/nodes/index.ts` | Export nodeTypes record for ReactFlow |
| `src/components/Canvas/layout.ts` | Tree layout algorithm: position nodes hierarchically |
| `public/tree-sitter.wasm` | web-tree-sitter runtime WASM |
| `public/tree-sitter-typescript.wasm` | TypeScript grammar WASM |
| `public/tree-sitter-javascript.wasm` | JavaScript grammar WASM |

### Modified Files

| File | Changes |
|------|---------|
| `src/views/Canvas.tsx` | Add nodeTypes, Breadcrumbs overlay, wire browser store to generate nodes/edges |
| `src/store/canvas.ts` | No changes — browser store calls setNodes/setEdges |
| `src/store/index.ts` | Export useBrowserStore |
| `package.json` | Add web-tree-sitter dependency |

---

## Task 1: Install web-tree-sitter and set up WASM files

**Files:**
- Modify: `package.json`
- Create: `public/tree-sitter.wasm`, `public/tree-sitter-typescript.wasm`, `public/tree-sitter-javascript.wasm`

- [ ] **Step 1: Install web-tree-sitter**

```bash
yarn add web-tree-sitter
```

- [ ] **Step 2: Copy WASM files to public/**

```bash
cp node_modules/web-tree-sitter/tree-sitter.wasm public/tree-sitter.wasm
```

For grammars, download pre-built WASM files from the tree-sitter playground or build them. The simplest path:

```bash
# Download pre-built grammar WASM files
npx tree-sitter-cli build --wasm node_modules/tree-sitter-typescript/typescript
npx tree-sitter-cli build --wasm node_modules/tree-sitter-javascript
```

If building is complex, use the CDN approach in the service instead (fetch from unpkg at runtime).

- [ ] **Step 3: Commit**

```bash
git add package.json yarn.lock public/tree-sitter*.wasm
git commit -m "feat: add web-tree-sitter dependency and WASM files"
```

---

## Task 2: Filesystem service

**Files:**
- Create: `src/services/filesystem.ts`

- [ ] **Step 1: Create the filesystem service**

```typescript
// src/services/filesystem.ts

export interface FSEntry {
  name: string
  path: string
  isDirectory: boolean
}

export async function readDirectory(dirPath: string): Promise<FSEntry[]> {
  const entries = await Neutralino.filesystem.readDirectory(dirPath)
  return entries
    .filter((e) => e.entry !== '.' && e.entry !== '..')
    .map((e) => ({
      name: e.entry,
      path: `${dirPath}/${e.entry}`,
      isDirectory: e.type === 'DIRECTORY',
    }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

export async function readFileContent(filePath: string): Promise<string> {
  return Neutralino.filesystem.readFile(filePath)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/filesystem.ts
git commit -m "feat: add filesystem service for directory/file reading"
```

---

## Task 3: Tree-sitter service with query definitions

**Files:**
- Create: `src/services/treesitter-queries.ts`
- Create: `src/services/treesitter.ts`

- [ ] **Step 1: Create query definitions**

```typescript
// src/services/treesitter-queries.ts

export interface LanguageConfig {
  extensions: string[]
  grammarPath: string
  declarationQuery: string
  importQuery: string
}

const typescriptConfig: LanguageConfig = {
  extensions: ['.ts', '.tsx'],
  grammarPath: '/tree-sitter-typescript.wasm',
  declarationQuery: `
    (function_declaration name: (identifier) @name) @decl
    (export_statement declaration: (function_declaration name: (identifier) @name)) @decl
    (lexical_declaration
      (variable_declarator
        name: (identifier) @name
        value: (arrow_function)) @decl)
    (export_statement
      declaration: (lexical_declaration
        (variable_declarator
          name: (identifier) @name
          value: (arrow_function))) @decl)
    (class_declaration name: (type_identifier) @name) @decl
    (export_statement declaration: (class_declaration name: (type_identifier) @name)) @decl
    (method_definition name: (property_identifier) @method_name) @method
  `,
  importQuery: `
    (import_statement source: (string (string_fragment) @source))
  `,
}

const javascriptConfig: LanguageConfig = {
  extensions: ['.js', '.jsx'],
  grammarPath: '/tree-sitter-javascript.wasm',
  declarationQuery: typescriptConfig.declarationQuery,
  importQuery: `
    (import_statement source: (string (string_fragment) @source))
    (call_expression
      function: (identifier) @fn (#eq? @fn "require")
      arguments: (arguments (string (string_fragment) @source)))
  `,
}

export const LANGUAGE_CONFIGS: LanguageConfig[] = [
  typescriptConfig,
  javascriptConfig,
]

export function getConfigForFile(filename: string): LanguageConfig | null {
  const ext = filename.slice(filename.lastIndexOf('.'))
  return LANGUAGE_CONFIGS.find((c) => c.extensions.includes(ext)) ?? null
}
```

- [ ] **Step 2: Create tree-sitter service**

```typescript
// src/services/treesitter.ts
import Parser from 'web-tree-sitter'
import { getConfigForFile, type LanguageConfig } from './treesitter-queries'

export interface Declaration {
  name: string
  kind: 'function' | 'class'
  startLine: number
  endLine: number
  children: Declaration[] // methods for classes
}

export interface ImportInfo {
  source: string // raw import path
  resolvedPath: string | null // resolved to absolute path if relative
}

export interface FileAnalysis {
  declarations: Declaration[]
  imports: ImportInfo[]
}

let parserInstance: Parser | null = null
const languageCache = new Map<string, Parser.Language>()

async function getParser(): Promise<Parser> {
  if (!parserInstance) {
    await Parser.init({
      locateFile: () => '/tree-sitter.wasm',
    })
    parserInstance = new Parser()
  }
  return parserInstance
}

async function getLanguage(config: LanguageConfig): Promise<Parser.Language> {
  const cached = languageCache.get(config.grammarPath)
  if (cached) return cached
  const lang = await Parser.Language.load(config.grammarPath)
  languageCache.set(config.grammarPath, lang)
  return lang
}

function resolveImportPath(source: string, currentFilePath: string): string | null {
  if (!source.startsWith('.')) return null // external package
  const dir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'))
  // Normalize simple relative paths
  const parts = `${dir}/${source}`.split('/')
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '..') resolved.pop()
    else if (part !== '.') resolved.push(part)
  }
  return resolved.join('/')
}

export async function analyzeFile(filePath: string, content: string): Promise<FileAnalysis> {
  const config = getConfigForFile(filePath)
  if (!config) return { declarations: [], imports: [] }

  const parser = await getParser()
  const language = await getLanguage(config)
  parser.setLanguage(language)

  const tree = parser.parse(content)

  // Extract declarations
  const declQuery = language.query(config.declarationQuery)
  const declMatches = declQuery.matches(tree.rootNode)
  const declarations: Declaration[] = []
  const classMap = new Map<number, Declaration>() // startRow -> class decl

  for (const match of declMatches) {
    const declCapture = match.captures.find((c) => c.name === 'decl')
    const nameCapture = match.captures.find((c) => c.name === 'name')
    const methodCapture = match.captures.find((c) => c.name === 'method')
    const methodNameCapture = match.captures.find((c) => c.name === 'method_name')

    if (methodCapture && methodNameCapture) {
      // Find parent class
      let parent = methodCapture.node.parent
      while (parent && parent.type !== 'class_body') parent = parent.parent
      if (parent?.parent) {
        const classDecl = classMap.get(parent.parent.startPosition.row)
        if (classDecl) {
          classDecl.children.push({
            name: methodNameCapture.node.text,
            kind: 'function',
            startLine: methodCapture.node.startPosition.row,
            endLine: methodCapture.node.endPosition.row,
            children: [],
          })
        }
      }
      continue
    }

    if (declCapture && nameCapture) {
      const isClass = declCapture.node.type === 'class_declaration' ||
        (declCapture.node.type === 'export_statement' && declCapture.node.childForFieldName('declaration')?.type === 'class_declaration')
      const decl: Declaration = {
        name: nameCapture.node.text,
        kind: isClass ? 'class' : 'function',
        startLine: declCapture.node.startPosition.row,
        endLine: declCapture.node.endPosition.row,
        children: [],
      }
      declarations.push(decl)
      if (isClass) {
        // Find the actual class_declaration node for startRow mapping
        const classNode = isClass && declCapture.node.type === 'export_statement'
          ? declCapture.node.childForFieldName('declaration')!
          : declCapture.node
        classMap.set(classNode.startPosition.row, decl)
      }
    }
  }

  // Extract imports
  const importQuery = language.query(config.importQuery)
  const importMatches = importQuery.matches(tree.rootNode)
  const imports: ImportInfo[] = []

  for (const match of importMatches) {
    const sourceCapture = match.captures.find((c) => c.name === 'source')
    if (sourceCapture) {
      imports.push({
        source: sourceCapture.node.text,
        resolvedPath: resolveImportPath(sourceCapture.node.text, filePath),
      })
    }
  }

  return { declarations, imports }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/services/treesitter.ts src/services/treesitter-queries.ts
git commit -m "feat: add tree-sitter service for JS/TS parsing"
```

---

## Task 4: Browser store (navigation state)

**Files:**
- Create: `src/store/browser.ts`
- Modify: `src/store/index.ts`

- [ ] **Step 1: Create browser store**

```typescript
// src/store/browser.ts
import { create } from 'zustand'
import type { Node, Edge } from '@xyflow/react'
import { readDirectory, readFileContent, type FSEntry } from '@/services/filesystem'
import { analyzeFile, type FileAnalysis } from '@/services/treesitter'
import { layoutTree } from '@/components/Canvas/layout'

export type ViewMode = 'directory' | 'file'

interface BreadcrumbEntry {
  path: string
  label: string
  mode: ViewMode
}

interface BrowserState {
  currentPath: string
  viewMode: ViewMode
  breadcrumbs: BreadcrumbEntry[]
  loading: boolean
  entries: FSEntry[]
  fileAnalysis: FileAnalysis | null
  // Sibling file analyses for cross-file import edges
  siblingAnalyses: Map<string, FileAnalysis>

  navigateTo: (path: string, mode: ViewMode) => Promise<void>
  navigateToBreadcrumb: (index: number) => void
  generateNodes: () => { nodes: Node[]; edges: Edge[] }
}

export const useBrowserStore = create<BrowserState>((set, get) => ({
  currentPath: '',
  viewMode: 'directory',
  breadcrumbs: [],
  loading: false,
  entries: [],
  fileAnalysis: null,
  siblingAnalyses: new Map(),

  navigateTo: async (path, mode) => {
    set({ loading: true })

    if (mode === 'directory') {
      const entries = await readDirectory(path)
      const state = get()
      // Build breadcrumbs: if navigating deeper, push; if going back, will use navigateToBreadcrumb
      const breadcrumbs: BreadcrumbEntry[] = [
        ...state.breadcrumbs.filter((b) => path.startsWith(b.path) && b.path !== path),
        { path, label: path.split('/').pop() || path, mode },
      ]
      set({ currentPath: path, viewMode: mode, entries, fileAnalysis: null, breadcrumbs, loading: false, siblingAnalyses: new Map() })
    } else {
      // File mode: parse the file and sibling files for import edges
      const content = await readFileContent(path)
      const analysis = await analyzeFile(path, content)

      // Resolve imports to sibling files in the same directory
      const dir = path.substring(0, path.lastIndexOf('/'))
      const siblingAnalyses = new Map<string, FileAnalysis>()
      const dirEntries = await readDirectory(dir)
      for (const imp of analysis.imports) {
        if (!imp.resolvedPath) continue
        // Try to find the actual file (with extensions)
        const candidates = [imp.resolvedPath, `${imp.resolvedPath}.ts`, `${imp.resolvedPath}.tsx`, `${imp.resolvedPath}.js`, `${imp.resolvedPath}.jsx`, `${imp.resolvedPath}/index.ts`, `${imp.resolvedPath}/index.tsx`]
        for (const candidate of candidates) {
          const found = dirEntries.find((e) => !e.isDirectory && e.path === candidate)
          if (found && !siblingAnalyses.has(candidate)) {
            try {
              const sibContent = await readFileContent(candidate)
              const sibAnalysis = await analyzeFile(candidate, sibContent)
              siblingAnalyses.set(candidate, sibAnalysis)
            } catch { /* file not readable */ }
            break
          }
        }
      }

      const state = get()
      const fileName = path.split('/').pop() || path
      const breadcrumbs: BreadcrumbEntry[] = [
        ...state.breadcrumbs.filter((b) => b.mode === 'directory'),
        { path, label: fileName, mode },
      ]
      set({ currentPath: path, viewMode: mode, fileAnalysis: analysis, entries: [], breadcrumbs, loading: false, siblingAnalyses })
    }
  },

  navigateToBreadcrumb: (index) => {
    const { breadcrumbs } = get()
    const target = breadcrumbs[index]
    if (!target) return
    get().navigateTo(target.path, target.mode)
  },

  generateNodes: () => {
    const { viewMode, entries, fileAnalysis, currentPath, siblingAnalyses } = get()

    if (viewMode === 'directory') {
      const nodes: Node[] = entries.map((entry, i) => ({
        id: entry.path,
        type: entry.isDirectory ? 'folder' : 'file',
        position: { x: 0, y: 0 }, // layout will override
        data: { label: entry.name, path: entry.path, isDirectory: entry.isDirectory },
      }))
      return layoutTree(nodes, [])
    }

    if (viewMode === 'file' && fileAnalysis) {
      const nodes: Node[] = []
      const edges: Edge[] = []
      const fileId = `file:${currentPath}`

      // Current file's declarations
      for (const decl of fileAnalysis.declarations) {
        const nodeId = `${fileId}:${decl.name}`
        nodes.push({
          id: nodeId,
          type: decl.kind === 'class' ? 'classNode' : 'functionNode',
          position: { x: 0, y: 0 },
          data: { label: decl.name, kind: decl.kind, startLine: decl.startLine, endLine: decl.endLine },
        })

        // Class methods as children
        for (const method of decl.children) {
          const methodId = `${nodeId}:${method.name}`
          nodes.push({
            id: methodId,
            type: 'functionNode',
            position: { x: 0, y: 0 },
            data: { label: method.name, kind: 'function', startLine: method.startLine, endLine: method.endLine, isMethod: true },
          })
          edges.push({
            id: `e-${nodeId}-${methodId}`,
            source: nodeId,
            target: methodId,
            type: 'smoothstep',
          })
        }
      }

      // Import edges to sibling file nodes
      for (const imp of fileAnalysis.imports) {
        if (!imp.resolvedPath) continue
        // Find the resolved file in sibling analyses
        for (const [resolvedFile, sibAnalysis] of siblingAnalyses) {
          if (resolvedFile.startsWith(imp.resolvedPath)) {
            const sibFileId = `sibling:${resolvedFile}`
            const fileName = resolvedFile.split('/').pop() || resolvedFile
            // Add sibling file as a collapsed node
            if (!nodes.find((n) => n.id === sibFileId)) {
              nodes.push({
                id: sibFileId,
                type: 'file',
                position: { x: 0, y: 0 },
                data: { label: fileName, path: resolvedFile, isImport: true, declarationCount: sibAnalysis.declarations.length },
              })
            }
            // Edge from current file root to sibling
            edges.push({
              id: `e-import-${fileId}-${sibFileId}`,
              source: nodes[0]?.id || fileId, // first declaration
              target: sibFileId,
              type: 'smoothstep',
              animated: true,
              label: 'imports',
              style: { stroke: '#6366f1' },
            })
            break
          }
        }
      }

      return layoutTree(nodes, edges)
    }

    return { nodes: [], edges: [] }
  },
}))
```

- [ ] **Step 2: Export from store index**

Add to `src/store/index.ts`:
```typescript
export { useBrowserStore } from './browser'
```

- [ ] **Step 3: Commit**

```bash
git add src/store/browser.ts src/store/index.ts
git commit -m "feat: add browser store for canvas navigation state"
```

---

## Task 5: Tree layout algorithm

**Files:**
- Create: `src/components/Canvas/layout.ts`

- [ ] **Step 1: Create layout algorithm**

```typescript
// src/components/Canvas/layout.ts
import type { Node, Edge } from '@xyflow/react'

const NODE_WIDTH = 200
const NODE_HEIGHT = 60
const H_GAP = 40
const V_GAP = 80

export function layoutTree(
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  if (nodes.length === 0) return { nodes, edges }

  // Build adjacency from edges (source -> targets)
  const children = new Map<string, string[]>()
  const hasParent = new Set<string>()

  for (const edge of edges) {
    const list = children.get(edge.source) || []
    list.push(edge.target)
    children.set(edge.source, list)
    hasParent.add(edge.target)
  }

  // Roots: nodes without parents
  const roots = nodes.filter((n) => !hasParent.has(n.id))
  // Standalone nodes (no edges): lay out in grid
  const inEdge = new Set([...hasParent, ...children.keys()])
  const standalone = nodes.filter((n) => !inEdge.has(n.id))

  const positioned = new Map<string, { x: number; y: number }>()

  // Position a subtree, returns its width
  function positionSubtree(nodeId: string, x: number, y: number): number {
    const kids = children.get(nodeId) || []
    if (kids.length === 0) {
      positioned.set(nodeId, { x, y })
      return NODE_WIDTH
    }

    let totalWidth = 0
    for (let i = 0; i < kids.length; i++) {
      const childWidth = positionSubtree(kids[i], x + totalWidth, y + NODE_HEIGHT + V_GAP)
      totalWidth += childWidth + (i < kids.length - 1 ? H_GAP : 0)
    }

    const subtreeWidth = Math.max(totalWidth, NODE_WIDTH)
    positioned.set(nodeId, { x: x + (subtreeWidth - NODE_WIDTH) / 2, y })
    return subtreeWidth
  }

  // Position root trees
  let offsetX = 0
  for (const root of roots.filter((r) => !standalone.includes(r))) {
    const width = positionSubtree(root.id, offsetX, 0)
    offsetX += width + H_GAP * 2
  }

  // Position standalone nodes in a grid
  const cols = Math.max(1, Math.ceil(Math.sqrt(standalone.length)))
  standalone.forEach((node, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    positioned.set(node.id, {
      x: col * (NODE_WIDTH + H_GAP),
      y: row * (NODE_HEIGHT + V_GAP),
    })
  })

  const layoutNodes = nodes.map((node) => ({
    ...node,
    position: positioned.get(node.id) || node.position,
  }))

  return { nodes: layoutNodes, edges }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Canvas/layout.ts
git commit -m "feat: add tree layout algorithm for canvas nodes"
```

---

## Task 6: Custom ReactFlow nodes

**Files:**
- Create: `src/components/Canvas/nodes/FolderNode.tsx`
- Create: `src/components/Canvas/nodes/FileNode.tsx`
- Create: `src/components/Canvas/nodes/FunctionNode.tsx`
- Create: `src/components/Canvas/nodes/ClassNode.tsx`
- Create: `src/components/Canvas/nodes/index.ts`

- [ ] **Step 1: Create FolderNode**

```tsx
// src/components/Canvas/nodes/FolderNode.tsx
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Folder } from 'lucide-react'
import { useBrowserStore } from '@/store'

export default function FolderNode({ data }: NodeProps) {
  const navigateTo = useBrowserStore((s) => s.navigateTo)

  return (
    <div
      className="bg-background/90 backdrop-blur border border-border rounded-lg px-4 py-3 cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors min-w-[180px]"
      onClick={() => navigateTo(data.path as string, 'directory')}
    >
      <div className="flex items-center gap-2">
        <Folder className="h-4 w-4 text-yellow-500" />
        <span className="text-sm font-medium text-foreground truncate">{data.label as string}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <Handle type="target" position={Position.Top} className="opacity-0" />
    </div>
  )
}
```

- [ ] **Step 2: Create FileNode**

```tsx
// src/components/Canvas/nodes/FileNode.tsx
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { FileText, FileCode } from 'lucide-react'
import { useBrowserStore } from '@/store'
import { getConfigForFile } from '@/services/treesitter-queries'

export default function FileNode({ data }: NodeProps) {
  const navigateTo = useBrowserStore((s) => s.navigateTo)
  const parseable = getConfigForFile(data.label as string) !== null
  const isImport = data.isImport as boolean | undefined
  const Icon = parseable ? FileCode : FileText

  return (
    <div
      className={`bg-background/90 backdrop-blur border rounded-lg px-4 py-3 min-w-[180px] transition-colors ${
        parseable ? 'cursor-pointer hover:border-primary/50 hover:bg-muted/50' : ''
      } ${isImport ? 'border-indigo-500/50 border-dashed' : 'border-border'}`}
      onClick={() => {
        if (parseable) navigateTo(data.path as string, 'file')
      }}
    >
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${parseable ? 'text-blue-400' : 'text-muted-foreground'}`} />
        <span className="text-sm font-medium text-foreground truncate">{data.label as string}</span>
      </div>
      {isImport && data.declarationCount && (
        <div className="text-xs text-muted-foreground mt-1">{data.declarationCount as number} declarations</div>
      )}
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <Handle type="target" position={Position.Top} className="opacity-0" />
    </div>
  )
}
```

- [ ] **Step 3: Create FunctionNode**

```tsx
// src/components/Canvas/nodes/FunctionNode.tsx
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Braces } from 'lucide-react'

export default function FunctionNode({ data }: NodeProps) {
  const isMethod = data.isMethod as boolean | undefined

  return (
    <div className={`bg-background/90 backdrop-blur border border-border rounded-lg px-4 py-3 min-w-[160px] ${isMethod ? 'ml-4' : ''}`}>
      <div className="flex items-center gap-2">
        <Braces className="h-3.5 w-3.5 text-emerald-400" />
        <span className="text-sm text-foreground truncate">{data.label as string}</span>
        <span className="text-xs text-muted-foreground">fn</span>
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">
        L{data.startLine as number}–{data.endLine as number}
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <Handle type="target" position={Position.Top} className="opacity-0" />
    </div>
  )
}
```

- [ ] **Step 4: Create ClassNode**

```tsx
// src/components/Canvas/nodes/ClassNode.tsx
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Box } from 'lucide-react'

export default function ClassNode({ data }: NodeProps) {
  return (
    <div className="bg-background/90 backdrop-blur border border-purple-500/50 rounded-lg px-4 py-3 min-w-[180px]">
      <div className="flex items-center gap-2">
        <Box className="h-4 w-4 text-purple-400" />
        <span className="text-sm font-medium text-foreground truncate">{data.label as string}</span>
        <span className="text-xs text-muted-foreground">class</span>
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">
        L{data.startLine as number}–{data.endLine as number}
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <Handle type="target" position={Position.Top} className="opacity-0" />
    </div>
  )
}
```

- [ ] **Step 5: Create nodeTypes index**

```typescript
// src/components/Canvas/nodes/index.ts
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
```

- [ ] **Step 6: Commit**

```bash
git add src/components/Canvas/nodes/
git commit -m "feat: add custom ReactFlow nodes for folder, file, function, class"
```

---

## Task 7: Breadcrumbs component

**Files:**
- Create: `src/components/Canvas/Breadcrumbs.tsx`

- [ ] **Step 1: Create Breadcrumbs component**

```tsx
// src/components/Canvas/Breadcrumbs.tsx
import { ChevronRight, Home } from 'lucide-react'
import { useBrowserStore } from '@/store'

export default function Breadcrumbs() {
  const { breadcrumbs, navigateToBreadcrumb, currentPath, loading } = useBrowserStore()

  if (breadcrumbs.length === 0 && !currentPath) return null

  return (
    <div className="absolute top-3 left-3 z-20 pointer-events-auto">
      <div className="flex items-center gap-1 bg-background/90 backdrop-blur-md border border-border rounded-lg px-3 py-1.5 shadow-lg">
        <button
          className="text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => {
            // Navigate to parent of first breadcrumb (go to root)
            const root = breadcrumbs[0]
            if (root) {
              const parent = root.path.substring(0, root.path.lastIndexOf('/'))
              if (parent) useBrowserStore.getState().navigateTo(parent, 'directory')
            }
          }}
        >
          <Home className="h-3.5 w-3.5" />
        </button>

        {breadcrumbs.map((crumb, i) => (
          <div key={crumb.path} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            <button
              className={`text-xs transition-colors ${
                i === breadcrumbs.length - 1
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => navigateToBreadcrumb(i)}
              disabled={i === breadcrumbs.length - 1}
            >
              {crumb.label}
            </button>
          </div>
        ))}

        {loading && (
          <div className="ml-2 h-3 w-3 border border-primary/50 border-t-primary rounded-full animate-spin" />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Canvas/Breadcrumbs.tsx
git commit -m "feat: add breadcrumbs navigation overlay for canvas"
```

---

## Task 8: Wire everything into Canvas.tsx

**Files:**
- Modify: `src/views/Canvas.tsx`

- [ ] **Step 1: Update Canvas to use browser store and custom nodes**

Replace the contents of `src/views/Canvas.tsx` with:

```tsx
// src/views/Canvas.tsx
import { useEffect, useCallback } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCanvasStore, useBrowserStore } from '../store'
import Layout from '../components/Layout'
import { nodeTypes } from '../components/Canvas/nodes'
import Breadcrumbs from '../components/Canvas/Breadcrumbs'

export default function Canvas() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, setNodes, setEdges } =
    useCanvasStore()
  const { currentPath, viewMode, generateNodes, navigateTo } = useBrowserStore()

  // Initialize with current working directory
  useEffect(() => {
    const init = async () => {
      try {
        const cwd = await Neutralino.os.getEnv('PWD') || '/home'
        navigateTo(cwd, 'directory')
      } catch {
        // Fallback if Neutralino not available
        navigateTo('/home', 'directory')
      }
    }
    if (!currentPath) init()
  }, [currentPath, navigateTo])

  // Regenerate nodes when navigation state changes
  const regenerate = useCallback(() => {
    const { nodes: newNodes, edges: newEdges } = generateNodes()
    setNodes(newNodes)
    setEdges(newEdges)
  }, [generateNodes, setNodes, setEdges])

  useEffect(() => {
    regenerate()
  }, [currentPath, viewMode, regenerate])

  return (
    <div className="dark w-screen h-screen bg-background text-foreground relative">
      <div className="absolute inset-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#555555" />
        </ReactFlow>
      </div>
      <Breadcrumbs />
      <div className="absolute inset-0 pointer-events-none z-10">
        <Layout />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/views/Canvas.tsx
git commit -m "feat: wire browser store and custom nodes into canvas view"
```

---

## Task 9: Integration testing and polish

- [ ] **Step 1: Run `yarn build` to verify TypeScript compiles**

```bash
yarn build
```

Expected: No type errors.

- [ ] **Step 2: Run `yarn dev` and test manually**

- Open the app
- Verify directory listing appears on canvas as tree nodes
- Click a folder → view replaces with folder contents
- Click a .ts/.tsx file → view shows functions/classes with import edges
- Click breadcrumbs → navigate back
- Verify layout looks clean and nodes don't overlap

- [ ] **Step 3: Fix any issues found during testing**

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete canvas file browser with tree-sitter integration"
```
