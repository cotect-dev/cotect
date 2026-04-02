import { describe, it, expect } from 'vitest'
import type { FSEntry } from '@/services/platform'
import type { FileAnalysis } from '@/services/treesitter'
import { resolveImportCandidates, findMatchingFile, generateDirectoryNodes, generateFileNodes } from './browser'

describe('resolveImportCandidates', () => {
  it('returns the base path plus all extension variants', () => {
    const candidates = resolveImportCandidates('/src/utils')
    expect(candidates[0]).toBe('/src/utils')
    expect(candidates).toContain('/src/utils.ts')
    expect(candidates).toContain('/src/utils.tsx')
    expect(candidates).toContain('/src/utils.js')
    expect(candidates).toContain('/src/utils.jsx')
    expect(candidates).toContain('/src/utils/index.ts')
    expect(candidates).toContain('/src/utils/index.tsx')
    expect(candidates).toHaveLength(7) // base + 6 extensions
  })

  it('works with paths that already have trailing segments', () => {
    const candidates = resolveImportCandidates('/src/components/Button')
    expect(candidates[0]).toBe('/src/components/Button')
    expect(candidates).toContain('/src/components/Button.tsx')
  })
})

describe('findMatchingFile', () => {
  it('returns exact match when file exists', () => {
    const files = new Set(['/src/utils.ts', '/src/index.ts'])
    expect(findMatchingFile('/src/utils', files)).toBe('/src/utils.ts')
  })

  it('returns base path if it matches directly', () => {
    const files = new Set(['/src/utils'])
    expect(findMatchingFile('/src/utils', files)).toBe('/src/utils')
  })

  it('returns index.ts variant when available', () => {
    const files = new Set(['/src/platform/index.ts'])
    expect(findMatchingFile('/src/platform', files)).toBe('/src/platform/index.ts')
  })

  it('returns undefined when no candidate matches', () => {
    const files = new Set(['/src/other.ts'])
    expect(findMatchingFile('/src/utils', files)).toBeUndefined()
  })

  it('prefers earlier extension candidates (ts before tsx)', () => {
    const files = new Set(['/src/utils.ts', '/src/utils.tsx'])
    expect(findMatchingFile('/src/utils', files)).toBe('/src/utils.ts')
  })
})

describe('generateDirectoryNodes', () => {
  it('returns empty nodes/edges for empty entries', () => {
    const result = generateDirectoryNodes([])
    expect(result.nodes).toEqual([])
    expect(result.edges).toEqual([])
  })

  it('creates folder nodes for directories', () => {
    const entries: FSEntry[] = [
      { name: 'src', path: '/project/src', isDirectory: true },
    ]
    const result = generateDirectoryNodes(entries)
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].type).toBe('folder')
    expect(result.nodes[0].data.label).toBe('src')
  })

  it('creates file nodes for files', () => {
    const entries: FSEntry[] = [
      { name: 'main.ts', path: '/project/main.ts', isDirectory: false },
    ]
    const result = generateDirectoryNodes(entries)
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].type).toBe('file')
    expect(result.nodes[0].data.label).toBe('main.ts')
  })

  it('creates mixed nodes and applies layout (no edges)', () => {
    const entries: FSEntry[] = [
      { name: 'src', path: '/project/src', isDirectory: true },
      { name: 'main.ts', path: '/project/main.ts', isDirectory: false },
      { name: 'utils.ts', path: '/project/utils.ts', isDirectory: false },
    ]
    const result = generateDirectoryNodes(entries)
    expect(result.nodes).toHaveLength(3)
    expect(result.edges).toEqual([])
    // Layout should have positioned nodes (not all at 0,0)
    const positions = result.nodes.map((n) => `${n.position.x},${n.position.y}`)
    const uniquePositions = new Set(positions)
    expect(uniquePositions.size).toBeGreaterThan(1)
  })
})

describe('generateFileNodes', () => {
  const emptyAnalysis: FileAnalysis = { declarations: [], imports: [] }

  it('returns empty nodes/edges for empty analysis', () => {
    const result = generateFileNodes(emptyAnalysis, '/src/app.ts', new Map())
    expect(result.nodes).toEqual([])
    expect(result.edges).toEqual([])
  })

  it('creates function nodes for function declarations', () => {
    const analysis: FileAnalysis = {
      declarations: [
        { name: 'doStuff', kind: 'function', startLine: 1, endLine: 5, children: [] },
      ],
      imports: [],
    }
    const result = generateFileNodes(analysis, '/src/app.ts', new Map())
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].type).toBe('functionNode')
    expect(result.nodes[0].data.label).toBe('doStuff')
  })

  it('creates class nodes for class declarations', () => {
    const analysis: FileAnalysis = {
      declarations: [
        { name: 'MyClass', kind: 'class', startLine: 1, endLine: 20, children: [] },
      ],
      imports: [],
    }
    const result = generateFileNodes(analysis, '/src/app.ts', new Map())
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].type).toBe('classNode')
    expect(result.nodes[0].data.label).toBe('MyClass')
  })

  it('creates method nodes as children of classes with edges', () => {
    const analysis: FileAnalysis = {
      declarations: [
        {
          name: 'MyClass', kind: 'class', startLine: 1, endLine: 20,
          children: [
            { name: 'render', kind: 'function', startLine: 3, endLine: 10, children: [] },
            { name: 'update', kind: 'function', startLine: 12, endLine: 18, children: [] },
          ],
        },
      ],
      imports: [],
    }
    const result = generateFileNodes(analysis, '/src/app.ts', new Map())

    // 1 class + 2 methods = 3 nodes
    expect(result.nodes).toHaveLength(3)

    const classNode = result.nodes.find((n) => n.type === 'classNode')
    expect(classNode).toBeDefined()

    const methodNodes = result.nodes.filter((n) => n.data && 'isMethod' in n.data && n.data.isMethod)
    expect(methodNodes).toHaveLength(2)

    // Should have edges from class to each method
    expect(result.edges).toHaveLength(2)
    for (const edge of result.edges) {
      expect(edge.source).toBe(classNode!.id)
    }
  })

  it('creates sibling file nodes for resolved imports', () => {
    const analysis: FileAnalysis = {
      declarations: [
        { name: 'main', kind: 'function', startLine: 1, endLine: 5, children: [] },
      ],
      imports: [
        { source: './utils', resolvedPath: '/src/utils' },
      ],
    }

    const siblingAnalyses = new Map<string, FileAnalysis>([
      ['/src/utils.ts', { declarations: [{ name: 'helper', kind: 'function', startLine: 1, endLine: 3, children: [] }], imports: [] }],
    ])

    const result = generateFileNodes(analysis, '/src/app.ts', siblingAnalyses)

    // 1 file node (import source) + 1 function + 1 sibling file = 3 nodes
    expect(result.nodes).toHaveLength(3)

    const fileNode = result.nodes.find((n) => n.id === 'file:/src/app.ts')
    expect(fileNode).toBeDefined()
    expect(fileNode!.data.label).toBe('app.ts')

    const siblingNode = result.nodes.find((n) => n.id.startsWith('sibling:'))
    expect(siblingNode).toBeDefined()
    expect(siblingNode!.data.label).toBe('utils.ts')
    expect((siblingNode!.data as Record<string, unknown>).isImport).toBe(true)
    expect((siblingNode!.data as Record<string, unknown>).declarationCount).toBe(1)

    // Import edge should source from the file node, not a declaration
    const importEdge = result.edges.find((e) => e.id.includes('import'))
    expect(importEdge).toBeDefined()
    expect(importEdge!.source).toBe('file:/src/app.ts')
    expect(importEdge!.animated).toBe(true)
  })

  it('does not duplicate sibling nodes for multiple imports from same file', () => {
    const analysis: FileAnalysis = {
      declarations: [
        { name: 'main', kind: 'function', startLine: 1, endLine: 5, children: [] },
      ],
      imports: [
        { source: './utils', resolvedPath: '/src/utils' },
        { source: './utils', resolvedPath: '/src/utils' },
      ],
    }

    const siblingAnalyses = new Map<string, FileAnalysis>([
      ['/src/utils.ts', { declarations: [], imports: [] }],
    ])

    const result = generateFileNodes(analysis, '/src/app.ts', siblingAnalyses)

    const siblingNodes = result.nodes.filter((n) => n.id.startsWith('sibling:'))
    expect(siblingNodes).toHaveLength(1) // not duplicated

    // Should also not duplicate edges
    const importEdges = result.edges.filter((e) => e.id.includes('import'))
    expect(importEdges).toHaveLength(1)

    // Total: 1 file node + 1 function + 1 sibling = 3
    expect(result.nodes).toHaveLength(3)
  })

  it('skips imports without resolvedPath', () => {
    const analysis: FileAnalysis = {
      declarations: [
        { name: 'main', kind: 'function', startLine: 1, endLine: 5, children: [] },
      ],
      imports: [
        { source: 'react', resolvedPath: null },
      ],
    }

    const result = generateFileNodes(analysis, '/src/app.ts', new Map())
    expect(result.nodes).toHaveLength(1) // only the function node
    expect(result.edges.filter((e) => e.id.includes('import'))).toHaveLength(0)
  })
})
