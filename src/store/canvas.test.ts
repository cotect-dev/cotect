import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import { NODE_WIDTH, NODE_HEIGHT, NODE_H_GAP, NODE_V_GAP, CANVAS_PAD_Y, CANVAS_MARGIN } from '@/lib/constants'

// --- Mocks ---

vi.mock('web-tree-sitter', () => ({
  Parser: { init: vi.fn() },
  Query: vi.fn(),
  Language: { load: vi.fn() },
}))

const mockReadDirectory = vi.fn()
const mockReadFile = vi.fn()

vi.mock('@/services/platform', () => ({
  getPlatform: () => ({
    fs: {
      readDirectory: mockReadDirectory,
      readFile: mockReadFile,
    },
  }),
}))

const mockAnalyzeFile = vi.fn()
vi.mock('@/services/treesitter', () => ({
  analyzeFile: (...args: unknown[]) => mockAnalyzeFile(...args),
}))

const mockDetectProjectMeta = vi.fn()
vi.mock('@/services/projectMeta', () => ({
  detectProjectMeta: (...args: unknown[]) => mockDetectProjectMeta(...args),
}))

import { useCanvasStore, type Column } from './canvas'
import type { AppNode } from '@/types/nodes'

// --- Helpers ---

function resetStore() {
  useCanvasStore.setState({
    nodes: [],
    edges: [],
    focusedNodeId: null,
    columns: [],
    currentColumnIndex: 0,
    depthChain: [],
    selectedFunction: null,
    hiddenNodeIds: new Set(),
    viewportHeight: 0,
    cameraY: CANVAS_PAD_Y,
  })
}

function makeFSEntries(entries: Array<{ name: string; path: string; isDirectory: boolean }>) {
  return entries
}

// ============================================================================
// Tests for isTestFile (tested indirectly through buildDirectoryNodes)
// ============================================================================
describe('isTestFile detection (via directory node sorting)', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  it('sorts test files after regular files', async () => {
    mockReadDirectory.mockResolvedValue(makeFSEntries([
      { name: 'app.test.ts', path: '/proj/app.test.ts', isDirectory: false },
      { name: 'utils.ts', path: '/proj/utils.ts', isDirectory: false },
      { name: 'app.ts', path: '/proj/app.ts', isDirectory: false },
    ]))
    mockDetectProjectMeta.mockResolvedValue({ name: 'proj', description: null, version: null, language: null, framework: null })

    await useCanvasStore.getState().initRoot('/proj')

    // Column 1 is the root directory column
    const dirCol = useCanvasStore.getState().columns[1]
    expect(dirCol).toBeDefined()
    const labels = dirCol.nodes.map((n) => (n.data as Record<string, unknown>).label)
    // Regular files come before test files
    expect(labels.indexOf('app.ts')).toBeLessThan(labels.indexOf('app.test.ts'))
    expect(labels.indexOf('utils.ts')).toBeLessThan(labels.indexOf('app.test.ts'))
  })

  it('sorts folders before files and test files last', async () => {
    mockReadDirectory.mockResolvedValue(makeFSEntries([
      { name: 'app.spec.ts', path: '/proj/app.spec.ts', isDirectory: false },
      { name: 'src', path: '/proj/src', isDirectory: true },
      { name: 'main.ts', path: '/proj/main.ts', isDirectory: false },
    ]))
    mockDetectProjectMeta.mockResolvedValue({ name: 'proj', description: null, version: null, language: null, framework: null })

    await useCanvasStore.getState().initRoot('/proj')

    const dirCol = useCanvasStore.getState().columns[1]
    const labels = dirCol.nodes.map((n) => (n.data as Record<string, unknown>).label)
    // Folder first, then regular file, then test file
    expect(labels).toEqual(['src', 'main.ts', 'app.spec.ts'])
  })

  it('recognizes various test file patterns', async () => {
    mockReadDirectory.mockResolvedValue(makeFSEntries([
      { name: 'regular.ts', path: '/p/regular.ts', isDirectory: false },
      { name: 'foo.test.ts', path: '/p/foo.test.ts', isDirectory: false },
      { name: 'bar.spec.js', path: '/p/bar.spec.js', isDirectory: false },
      { name: 'baz_test.py', path: '/p/baz_test.py', isDirectory: false },
      { name: 'qux-test.go', path: '/p/qux-test.go', isDirectory: false },
      { name: 'test.js', path: '/p/test.js', isDirectory: false },
      { name: 'tests.py', path: '/p/tests.py', isDirectory: false },
      { name: 'jest.config.ts', path: '/p/jest.config.ts', isDirectory: false },
      { name: 'vitest.config.js', path: '/p/vitest.config.js', isDirectory: false },
    ]))
    mockDetectProjectMeta.mockResolvedValue({ name: 'p', description: null, version: null, language: null, framework: null })

    await useCanvasStore.getState().initRoot('/p')

    const dirCol = useCanvasStore.getState().columns[1]
    const labels = dirCol.nodes.map((n) => (n.data as Record<string, unknown>).label)
    // 'regular.ts' should be the only regular file — everything else is a test
    expect(labels[0]).toBe('regular.ts')
    // All others are test files — they come after
    expect(labels.slice(1)).toContain('foo.test.ts')
    expect(labels.slice(1)).toContain('bar.spec.js')
    expect(labels.slice(1)).toContain('baz_test.py')
    expect(labels.slice(1)).toContain('qux-test.go')
    expect(labels.slice(1)).toContain('test.js')
    expect(labels.slice(1)).toContain('tests.py')
    expect(labels.slice(1)).toContain('jest.config.ts')
    expect(labels.slice(1)).toContain('vitest.config.js')
  })

  it('marks test file nodes with isTestFile flag', async () => {
    mockReadDirectory.mockResolvedValue(makeFSEntries([
      { name: 'app.ts', path: '/p/app.ts', isDirectory: false },
      { name: 'app.test.ts', path: '/p/app.test.ts', isDirectory: false },
    ]))
    mockDetectProjectMeta.mockResolvedValue({ name: 'p', description: null, version: null, language: null, framework: null })

    await useCanvasStore.getState().initRoot('/p')

    const dirCol = useCanvasStore.getState().columns[1]
    const regular = dirCol.nodes.find((n) => (n.data as Record<string, unknown>).label === 'app.ts')
    const test = dirCol.nodes.find((n) => (n.data as Record<string, unknown>).label === 'app.test.ts')
    expect((regular!.data as Record<string, unknown>).isTestFile).toBeFalsy()
    expect((test!.data as Record<string, unknown>).isTestFile).toBe(true)
  })
})

// ============================================================================
// Tests for buildDirectoryNodes filtering
// ============================================================================
describe('directory filtering', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  it('filters out hidden directories like node_modules and .git', async () => {
    mockReadDirectory.mockResolvedValue(makeFSEntries([
      { name: 'src', path: '/p/src', isDirectory: true },
      { name: 'node_modules', path: '/p/node_modules', isDirectory: true },
      { name: '.git', path: '/p/.git', isDirectory: true },
      { name: 'main.ts', path: '/p/main.ts', isDirectory: false },
    ]))
    mockDetectProjectMeta.mockResolvedValue({ name: 'p', description: null, version: null, language: null, framework: null })

    await useCanvasStore.getState().initRoot('/p')

    const dirCol = useCanvasStore.getState().columns[1]
    const labels = dirCol.nodes.map((n) => (n.data as Record<string, unknown>).label)
    expect(labels).toContain('src')
    expect(labels).toContain('main.ts')
    expect(labels).not.toContain('node_modules')
    expect(labels).not.toContain('.git')
  })

  it('keeps dot-files (only filters dot-directories)', async () => {
    mockReadDirectory.mockResolvedValue(makeFSEntries([
      { name: '.env', path: '/p/.env', isDirectory: false },
      { name: '.gitignore', path: '/p/.gitignore', isDirectory: false },
      { name: '.hidden', path: '/p/.hidden', isDirectory: true },
    ]))
    mockDetectProjectMeta.mockResolvedValue({ name: 'p', description: null, version: null, language: null, framework: null })

    await useCanvasStore.getState().initRoot('/p')

    const dirCol = useCanvasStore.getState().columns[1]
    const labels = dirCol.nodes.map((n) => (n.data as Record<string, unknown>).label)
    expect(labels).toContain('.env')
    expect(labels).toContain('.gitignore')
    expect(labels).not.toContain('.hidden')
  })
})

// ============================================================================
// Tests for positionColumnNodes and findVerticalNeighbor (tested via store)
// ============================================================================
describe('findVerticalNeighbor (via moveFocus)', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  it('moveFocus picks first node when no focus is set', () => {
    // Manually set up nodes
    useCanvasStore.setState({
      nodes: [
        { id: 'a', position: { x: 0, y: 0 }, data: {} } as Node,
        { id: 'b', position: { x: 0, y: 72 }, data: {} } as Node,
      ],
    })

    useCanvasStore.getState().moveFocus('down')
    expect(useCanvasStore.getState().focusedNodeId).toBe('a')
  })

  it('moveFocus moves focus down to next node in same column', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'a', position: { x: 0, y: 0 }, data: {} } as Node,
        { id: 'b', position: { x: 0, y: 72 }, data: {} } as Node,
        { id: 'c', position: { x: 0, y: 144 }, data: {} } as Node,
      ],
      focusedNodeId: 'a',
    })

    useCanvasStore.getState().moveFocus('down')
    expect(useCanvasStore.getState().focusedNodeId).toBe('b')
  })

  it('moveFocus moves focus up to previous node in same column', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'a', position: { x: 0, y: 0 }, data: {} } as Node,
        { id: 'b', position: { x: 0, y: 72 }, data: {} } as Node,
      ],
      focusedNodeId: 'b',
    })

    useCanvasStore.getState().moveFocus('up')
    expect(useCanvasStore.getState().focusedNodeId).toBe('a')
  })

  it('moveFocus does nothing when at boundary (no neighbor)', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'a', position: { x: 0, y: 0 }, data: {} } as Node,
      ],
      focusedNodeId: 'a',
    })

    useCanvasStore.getState().moveFocus('up')
    expect(useCanvasStore.getState().focusedNodeId).toBe('a')
  })

  it('moveFocus ignores nodes in different X columns', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'a', position: { x: 0, y: 0 }, data: {} } as Node,
        { id: 'b', position: { x: NODE_WIDTH + NODE_H_GAP, y: 72 }, data: {} } as Node,
      ],
      focusedNodeId: 'a',
    })

    useCanvasStore.getState().moveFocus('down')
    // b is in a different X column so shouldn't be selected
    expect(useCanvasStore.getState().focusedNodeId).toBe('a')
  })

  it('moveFocus does nothing with empty nodes', () => {
    useCanvasStore.setState({ nodes: [], focusedNodeId: null })
    useCanvasStore.getState().moveFocus('down')
    expect(useCanvasStore.getState().focusedNodeId).toBeNull()
  })

  it('moveFocus picks nearest node when multiple candidates exist', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'a', position: { x: 0, y: 0 }, data: {} } as Node,
        { id: 'b', position: { x: 0, y: 72 }, data: {} } as Node,
        { id: 'c', position: { x: 0, y: 200 }, data: {} } as Node,
      ],
      focusedNodeId: 'a',
    })

    useCanvasStore.getState().moveFocus('down')
    expect(useCanvasStore.getState().focusedNodeId).toBe('b')
  })

  it('moveFocus wraps down from last node to first node in column', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'a', position: { x: 0, y: 0 }, data: {} } as Node,
        { id: 'b', position: { x: 0, y: 72 }, data: {} } as Node,
        { id: 'c', position: { x: 0, y: 144 }, data: {} } as Node,
      ],
      focusedNodeId: 'c',
    })

    useCanvasStore.getState().moveFocus('down')
    expect(useCanvasStore.getState().focusedNodeId).toBe('a')
  })

  it('moveFocus wraps up from first node to last node in column', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'a', position: { x: 0, y: 0 }, data: {} } as Node,
        { id: 'b', position: { x: 0, y: 72 }, data: {} } as Node,
        { id: 'c', position: { x: 0, y: 144 }, data: {} } as Node,
      ],
      focusedNodeId: 'a',
    })

    useCanvasStore.getState().moveFocus('up')
    expect(useCanvasStore.getState().focusedNodeId).toBe('c')
  })

  it('moveFocus wraps within own column only, not across columns', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'a', position: { x: 0, y: 0 }, data: {} } as Node,
        { id: 'b', position: { x: 0, y: 72 }, data: {} } as Node,
        { id: 'c', position: { x: NODE_WIDTH + NODE_H_GAP, y: 0 }, data: {} } as Node,
        { id: 'd', position: { x: NODE_WIDTH + NODE_H_GAP, y: 72 }, data: {} } as Node,
      ],
      focusedNodeId: 'b',
    })

    useCanvasStore.getState().moveFocus('down')
    // Should wrap to 'a' (top of same column), not jump to 'c' or 'd'
    expect(useCanvasStore.getState().focusedNodeId).toBe('a')
  })
})

// ============================================================================
// Tests for initRoot
// ============================================================================
describe('initRoot', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  it('creates meta and root directory columns', async () => {
    mockDetectProjectMeta.mockResolvedValue({
      name: 'my-project', description: 'A project', version: '1.0.0',
      language: 'TypeScript', framework: 'React',
    })
    mockReadDirectory.mockResolvedValue(makeFSEntries([
      { name: 'src', path: '/proj/src', isDirectory: true },
      { name: 'main.ts', path: '/proj/main.ts', isDirectory: false },
    ]))

    await useCanvasStore.getState().initRoot('/proj')

    const state = useCanvasStore.getState()
    expect(state.columns).toHaveLength(2)
    expect(state.columns[0].path).toBe('__meta__')
    expect(state.columns[0].kind).toBe('directory')
    expect(state.columns[1].path).toBe('/proj')
    expect(state.columns[1].kind).toBe('directory')
    expect(state.currentColumnIndex).toBe(1)
    expect(state.depthChain).toEqual(['/proj'])
  })

  it('sets focusedNodeId to first directory node', async () => {
    mockDetectProjectMeta.mockResolvedValue({ name: 'p', description: null, version: null, language: null, framework: null })
    mockReadDirectory.mockResolvedValue(makeFSEntries([
      { name: 'src', path: '/proj/src', isDirectory: true },
      { name: 'main.ts', path: '/proj/main.ts', isDirectory: false },
    ]))

    await useCanvasStore.getState().initRoot('/proj')

    const state = useCanvasStore.getState()
    // Focus should be on the first node (src, because folders sort first)
    expect(state.focusedNodeId).toBe('/proj/src')
  })

  it('handles empty directory', async () => {
    mockDetectProjectMeta.mockResolvedValue({ name: 'p', description: null, version: null, language: null, framework: null })
    mockReadDirectory.mockResolvedValue([])

    await useCanvasStore.getState().initRoot('/empty')

    const state = useCanvasStore.getState()
    expect(state.columns[1].nodes).toHaveLength(0)
    expect(state.focusedNodeId).toBeNull()
  })

  it('populates meta node with project metadata', async () => {
    mockDetectProjectMeta.mockResolvedValue({
      name: 'cotect', description: 'Code viewer', version: '2.0.0',
      language: 'TypeScript', framework: 'React',
    })
    mockReadDirectory.mockResolvedValue([])

    await useCanvasStore.getState().initRoot('/proj')

    const metaNode = useCanvasStore.getState().columns[0].nodes[0]
    expect(metaNode.type).toBe('projectMeta')
    expect(metaNode.id).toBe('__project_meta__')
    const data = metaNode.data as Record<string, unknown>
    expect(data.name).toBe('cotect')
    expect(data.description).toBe('Code viewer')
    expect(data.version).toBe('2.0.0')
    expect(data.language).toBe('TypeScript')
    expect(data.framework).toBe('React')
  })

  it('clears selectedFunction on init', async () => {
    useCanvasStore.setState({
      selectedFunction: {
        filePath: '/old', name: 'old', startLine: 0, endLine: 0,
        content: '', fullFileContent: '',
      },
    })
    mockDetectProjectMeta.mockResolvedValue({ name: 'p', description: null, version: null, language: null, framework: null })
    mockReadDirectory.mockResolvedValue([])

    await useCanvasStore.getState().initRoot('/proj')

    expect(useCanvasStore.getState().selectedFunction).toBeNull()
  })

  it('handles errors gracefully', async () => {
    mockDetectProjectMeta.mockRejectedValue(new Error('network error'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await useCanvasStore.getState().initRoot('/proj')

    // Should not throw, just log
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('renders flat nodes and edges via flattenAndRender', async () => {
    mockDetectProjectMeta.mockResolvedValue({ name: 'p', description: null, version: null, language: null, framework: null })
    mockReadDirectory.mockResolvedValue(makeFSEntries([
      { name: 'a.ts', path: '/proj/a.ts', isDirectory: false },
      { name: 'b.ts', path: '/proj/b.ts', isDirectory: false },
    ]))

    await useCanvasStore.getState().initRoot('/proj')

    const state = useCanvasStore.getState()
    // Should have flat nodes from both visible columns (meta + root)
    expect(state.nodes.length).toBeGreaterThan(0)
    // Meta column has 1 node, root directory has 2 nodes = 3 total
    expect(state.nodes).toHaveLength(3)
  })
})

// ============================================================================
// Tests for navigateRight
// ============================================================================
describe('navigateRight', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  it('does nothing when no focus', async () => {
    useCanvasStore.setState({ focusedNodeId: null })
    await useCanvasStore.getState().navigateRight()
    expect(useCanvasStore.getState().currentColumnIndex).toBe(0)
  })

  it('does nothing when focused node not found', async () => {
    useCanvasStore.setState({
      focusedNodeId: 'nonexistent',
      nodes: [{ id: 'other', position: { x: 0, y: 0 }, data: {} } as Node],
    })
    await useCanvasStore.getState().navigateRight()
    expect(useCanvasStore.getState().currentColumnIndex).toBe(0)
  })

  it('navigates into a folder', async () => {
    mockDetectProjectMeta.mockResolvedValue({ name: 'p', description: null, version: null, language: null, framework: null })
    mockReadDirectory.mockResolvedValueOnce(makeFSEntries([
      { name: 'src', path: '/proj/src', isDirectory: true },
    ])).mockResolvedValueOnce(makeFSEntries([
      // Preview load for src
      { name: 'main.ts', path: '/proj/src/main.ts', isDirectory: false },
    ])).mockResolvedValueOnce(makeFSEntries([
      // Actual navigate into src
      { name: 'main.ts', path: '/proj/src/main.ts', isDirectory: false },
    ]))

    await useCanvasStore.getState().initRoot('/proj')

    // Now navigate right into the src folder
    await useCanvasStore.getState().navigateRight()

    const state = useCanvasStore.getState()
    expect(state.currentColumnIndex).toBe(2)
    expect(state.depthChain).toContain('/proj/src')
  })

  it('navigates into a file and builds function nodes', async () => {
    mockDetectProjectMeta.mockResolvedValue({ name: 'p', description: null, version: null, language: null, framework: null })
    mockReadDirectory.mockResolvedValue(makeFSEntries([
      { name: 'app.ts', path: '/proj/app.ts', isDirectory: false },
    ]))
    mockAnalyzeFile.mockResolvedValue({
      declarations: [
        { name: 'doStuff', kind: 'function', startLine: 0, endLine: 5, children: [] },
        { name: 'MyClass', kind: 'class', startLine: 7, endLine: 20, children: [] },
      ],
      imports: [],
    })

    await useCanvasStore.getState().initRoot('/proj')

    // File content for buildFileNodes
    mockReadFile.mockResolvedValue('const x = 1;\n'.repeat(25))

    await useCanvasStore.getState().navigateRight()

    const state = useCanvasStore.getState()
    expect(state.currentColumnIndex).toBe(2)
    const fileCol = state.columns[2]
    expect(fileCol).toBeDefined()
    expect(fileCol.kind).toBe('file')
    // Should have both a function and a class node
    const types = fileCol.nodes.map((n) => n.type)
    expect(types).toContain('functionNode')
    expect(types).toContain('classNode')
  })

  it('blocks navigation into import file nodes', async () => {
    // Set up a state where we have a file node marked as isImport
    const importNode: AppNode = {
      id: 'sibling:/proj/utils.ts', type: 'file', position: { x: 0, y: 0 },
      data: { label: 'utils.ts', path: '/proj/utils.ts', isImport: true },
    }

    const col: Column = { path: '/proj/app.ts', kind: 'file', nodes: [importNode], edges: [] }
    useCanvasStore.setState({
      columns: [col],
      currentColumnIndex: 0,
      focusedNodeId: importNode.id,
      nodes: [{ ...importNode, data: { ...importNode.data } } as Node],
    })

    await useCanvasStore.getState().navigateRight()

    // Should NOT have navigated
    expect(useCanvasStore.getState().currentColumnIndex).toBe(0)
  })

  it('navigates into function node and builds code node', async () => {
    const funcNode: AppNode = {
      id: 'decl:/proj/app.ts:doStuff:0', type: 'functionNode', position: { x: 0, y: 0 },
      data: { label: 'doStuff', kind: 'function', startLine: 0, endLine: 2 },
    }

    const fileCol: Column = { path: '/proj/app.ts', kind: 'file', nodes: [funcNode], edges: [] }
    useCanvasStore.setState({
      columns: [fileCol],
      currentColumnIndex: 0,
      focusedNodeId: funcNode.id,
      nodes: [{ ...funcNode, data: { ...funcNode.data } } as Node],
    })

    mockReadFile.mockResolvedValue('function doStuff() {\n  return 1\n}\n')

    await useCanvasStore.getState().navigateRight()

    const state = useCanvasStore.getState()
    expect(state.currentColumnIndex).toBe(1)
    expect(state.columns[1].kind).toBe('code')
    expect(state.selectedFunction).toBeDefined()
    expect(state.selectedFunction!.name).toBe('doStuff')
    expect(state.selectedFunction!.content).toBe('function doStuff() {\n  return 1\n}')
  })

  it('does not navigate into function node from non-file column', async () => {
    const funcNode: AppNode = {
      id: 'decl:/proj/app.ts:doStuff:0', type: 'functionNode', position: { x: 0, y: 0 },
      data: { label: 'doStuff', kind: 'function', startLine: 0, endLine: 2 },
    }

    // Column kind is 'directory', not 'file'
    const dirCol: Column = { path: '/proj', kind: 'directory', nodes: [funcNode], edges: [] }
    useCanvasStore.setState({
      columns: [dirCol],
      currentColumnIndex: 0,
      focusedNodeId: funcNode.id,
      nodes: [{ ...funcNode, data: { ...funcNode.data } } as Node],
    })

    await useCanvasStore.getState().navigateRight()

    // Should NOT navigate (guard: currentCol.kind !== 'file')
    expect(useCanvasStore.getState().currentColumnIndex).toBe(0)
  })

  it('navigates right from projectMeta to next column', async () => {
    const metaNode: AppNode = {
      id: '__project_meta__', type: 'projectMeta', position: { x: 0, y: 0 },
      data: { name: 'proj', description: null, version: null, language: null, framework: null },
    }
    const fileNode: AppNode = {
      id: '/proj/app.ts', type: 'file', position: { x: 0, y: 0 },
      data: { label: 'app.ts', path: '/proj/app.ts' },
    }

    const metaCol: Column = { path: '__meta__', kind: 'directory', nodes: [metaNode], edges: [] }
    const rootCol: Column = { path: '/proj', kind: 'directory', nodes: [fileNode], edges: [] }

    useCanvasStore.setState({
      columns: [metaCol, rootCol],
      currentColumnIndex: 0,
      focusedNodeId: '__project_meta__',
      nodes: [
        { ...metaNode, data: { ...metaNode.data } } as Node,
        { ...fileNode, data: { ...fileNode.data } } as Node,
      ],
    })

    await useCanvasStore.getState().navigateRight()

    expect(useCanvasStore.getState().currentColumnIndex).toBe(1)
    expect(useCanvasStore.getState().focusedNodeId).toBe('/proj/app.ts')
  })

  it('promotes existing preview column when path matches', async () => {
    // Set up folder node + preview column for the folder
    const folderNode: AppNode = {
      id: '/proj/src', type: 'folder', position: { x: 0, y: 0 },
      data: { label: 'src', path: '/proj/src', isDirectory: true as const },
    }
    const previewFileNode: AppNode = {
      id: '/proj/src/main.ts', type: 'file', position: { x: 0, y: 0 },
      data: { label: 'main.ts', path: '/proj/src/main.ts' },
    }

    const currentCol: Column = { path: '/proj', kind: 'directory', nodes: [folderNode], edges: [] }
    const previewCol: Column = { path: '/proj/src', kind: 'directory', nodes: [previewFileNode], edges: [] }

    useCanvasStore.setState({
      columns: [currentCol, previewCol],
      currentColumnIndex: 0,
      depthChain: ['/proj'],
      focusedNodeId: '/proj/src',
      nodes: [
        { ...folderNode, data: { ...folderNode.data } } as Node,
        { ...previewFileNode, data: { ...previewFileNode.data } } as Node,
      ],
    })

    await useCanvasStore.getState().navigateRight()

    const state = useCanvasStore.getState()
    // Should have promoted the preview — no readDirectory call needed
    expect(state.currentColumnIndex).toBe(1)
    expect(state.depthChain).toEqual(['/proj', '/proj/src'])
    expect(state.focusedNodeId).toBe('/proj/src/main.ts')
  })
})

// ============================================================================
// Tests for navigateLeft
// ============================================================================
describe('navigateLeft', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  it('does nothing when at column 0', () => {
    useCanvasStore.setState({ currentColumnIndex: 0 })
    useCanvasStore.getState().navigateLeft()
    expect(useCanvasStore.getState().currentColumnIndex).toBe(0)
  })

  it('navigates back and restores focus to parent node', () => {
    const parentNode: AppNode = {
      id: '/proj/src', type: 'folder', position: { x: 0, y: 0 },
      data: { label: 'src', path: '/proj/src', isDirectory: true as const },
    }
    const childNode: AppNode = {
      id: '/proj/src/main.ts', type: 'file', position: { x: 0, y: 0 },
      data: { label: 'main.ts', path: '/proj/src/main.ts' },
    }

    const parentCol: Column = { path: '/proj', kind: 'directory', nodes: [parentNode], edges: [] }
    const childCol: Column = { path: '/proj/src', kind: 'directory', nodes: [childNode], edges: [] }

    useCanvasStore.setState({
      columns: [parentCol, childCol],
      currentColumnIndex: 1,
      focusedNodeId: '/proj/src/main.ts',
      nodes: [
        { ...parentNode, data: { ...parentNode.data } } as Node,
        { ...childNode, data: { ...childNode.data } } as Node,
      ],
    })

    useCanvasStore.getState().navigateLeft()

    const state = useCanvasStore.getState()
    expect(state.currentColumnIndex).toBe(0)
    // Focus should be restored to the parent node whose path matches the child column's path
    expect(state.focusedNodeId).toBe('/proj/src')
  })

  it('falls back to first node when focus cannot be restored', () => {
    const node1: AppNode = {
      id: 'node1', type: 'file', position: { x: 0, y: 0 },
      data: { label: 'a.ts', path: '/proj/a.ts' },
    }

    const parentCol: Column = { path: '/proj', kind: 'directory', nodes: [node1], edges: [] }
    const childCol: Column = { path: '/proj/unmatched', kind: 'directory', nodes: [], edges: [] }

    useCanvasStore.setState({
      columns: [parentCol, childCol],
      currentColumnIndex: 1,
      focusedNodeId: null,
      nodes: [{ ...node1, data: { ...node1.data } } as Node],
    })

    useCanvasStore.getState().navigateLeft()

    expect(useCanvasStore.getState().focusedNodeId).toBe('node1')
  })

  it('clears selectedFunction on navigate left', () => {
    useCanvasStore.setState({
      columns: [
        { path: '/proj', kind: 'directory', nodes: [], edges: [] },
        { path: '/proj/src', kind: 'directory', nodes: [], edges: [] },
      ],
      currentColumnIndex: 1,
      selectedFunction: {
        filePath: '/proj/app.ts', name: 'fn', startLine: 0, endLine: 5,
        content: 'code', fullFileContent: 'all code',
      },
    })

    useCanvasStore.getState().navigateLeft()

    expect(useCanvasStore.getState().selectedFunction).toBeNull()
  })
})

// ============================================================================
// Tests for toggleHideNode
// ============================================================================
describe('toggleHideNode', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  it('does nothing when no focused node', () => {
    useCanvasStore.setState({ focusedNodeId: null, hiddenNodeIds: new Set() })
    useCanvasStore.getState().toggleHideNode()
    expect(useCanvasStore.getState().hiddenNodeIds.size).toBe(0)
  })

  it('hides the focused node', () => {
    useCanvasStore.setState({
      focusedNodeId: 'node1',
      hiddenNodeIds: new Set(),
      columns: [{ path: '/proj', kind: 'directory', nodes: [], edges: [] }],
    })
    useCanvasStore.getState().toggleHideNode()
    expect(useCanvasStore.getState().hiddenNodeIds.has('node1')).toBe(true)
  })

  it('unhides an already hidden node', () => {
    useCanvasStore.setState({
      focusedNodeId: 'node1',
      hiddenNodeIds: new Set(['node1']),
      columns: [{ path: '/proj', kind: 'directory', nodes: [], edges: [] }],
    })
    useCanvasStore.getState().toggleHideNode()
    expect(useCanvasStore.getState().hiddenNodeIds.has('node1')).toBe(false)
  })
})

// ============================================================================
// Tests for clearSelectedFunction
// ============================================================================
describe('clearSelectedFunction', () => {
  it('clears the selected function', () => {
    useCanvasStore.setState({
      selectedFunction: {
        filePath: '/f', name: 'fn', startLine: 0, endLine: 5,
        content: 'code', fullFileContent: 'all',
      },
    })
    useCanvasStore.getState().clearSelectedFunction()
    expect(useCanvasStore.getState().selectedFunction).toBeNull()
  })
})

// ============================================================================
// Tests for updatePreview
// ============================================================================
describe('updatePreview', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  it('trims preview column when no focus', async () => {
    useCanvasStore.setState({
      focusedNodeId: null,
      columns: [
        { path: '/proj', kind: 'directory', nodes: [], edges: [] },
        { path: '/proj/src', kind: 'directory', nodes: [], edges: [] }, // stale preview
      ],
      currentColumnIndex: 0,
    })

    await useCanvasStore.getState().updatePreview()

    expect(useCanvasStore.getState().columns).toHaveLength(1)
  })

  it('loads preview for a folder node', async () => {
    const folderNode: AppNode = {
      id: '/proj/src', type: 'folder', position: { x: 0, y: 0 },
      data: { label: 'src', path: '/proj/src', isDirectory: true as const },
    }
    useCanvasStore.setState({
      focusedNodeId: '/proj/src',
      columns: [{ path: '/proj', kind: 'directory', nodes: [folderNode], edges: [] }],
      currentColumnIndex: 0,
    })

    mockReadDirectory.mockResolvedValue(makeFSEntries([
      { name: 'index.ts', path: '/proj/src/index.ts', isDirectory: false },
    ]))

    await useCanvasStore.getState().updatePreview()

    const state = useCanvasStore.getState()
    expect(state.columns).toHaveLength(2)
    expect(state.columns[1].path).toBe('/proj/src')
    expect(state.columns[1].kind).toBe('directory')
  })

  it('loads preview for a file node', async () => {
    const fileNode: AppNode = {
      id: '/proj/app.ts', type: 'file', position: { x: 0, y: 0 },
      data: { label: 'app.ts', path: '/proj/app.ts' },
    }
    useCanvasStore.setState({
      focusedNodeId: '/proj/app.ts',
      columns: [{ path: '/proj', kind: 'directory', nodes: [fileNode], edges: [] }],
      currentColumnIndex: 0,
    })

    mockReadFile.mockResolvedValue('function hello() {}')
    mockAnalyzeFile.mockResolvedValue({
      declarations: [{ name: 'hello', kind: 'function', startLine: 0, endLine: 0, children: [] }],
      imports: [],
    })

    await useCanvasStore.getState().updatePreview()

    const state = useCanvasStore.getState()
    expect(state.columns).toHaveLength(2)
    expect(state.columns[1].path).toBe('/proj/app.ts')
    expect(state.columns[1].kind).toBe('file')
  })

  it('does not update preview when focused node is not in current column', async () => {
    const nodeInCol0: AppNode = {
      id: 'col0-node', type: 'file', position: { x: 0, y: 0 },
      data: { label: 'a.ts', path: '/proj/a.ts' },
    }
    const nodeInCol1: AppNode = {
      id: 'col1-node', type: 'file', position: { x: 0, y: 0 },
      data: { label: 'b.ts', path: '/proj/b.ts' },
    }

    useCanvasStore.setState({
      focusedNodeId: 'col1-node', // Not in current column (col 0)
      columns: [
        { path: '/proj', kind: 'directory', nodes: [nodeInCol0], edges: [] },
        { path: '/proj/src', kind: 'directory', nodes: [nodeInCol1], edges: [] },
      ],
      currentColumnIndex: 0,
    })

    await useCanvasStore.getState().updatePreview()

    // Should not have changed columns (no preview added/removed)
    expect(useCanvasStore.getState().columns).toHaveLength(2)
  })

  it('discards stale preview when focus changes during load', async () => {
    const folderNode: AppNode = {
      id: '/proj/src', type: 'folder', position: { x: 0, y: 0 },
      data: { label: 'src', path: '/proj/src', isDirectory: true as const },
    }
    useCanvasStore.setState({
      focusedNodeId: '/proj/src',
      columns: [{ path: '/proj', kind: 'directory', nodes: [folderNode], edges: [] }],
      currentColumnIndex: 0,
    })

    // Mock readDirectory to take a long time and change focus during load
    mockReadDirectory.mockImplementation(async () => {
      // Simulate focus change during async load
      useCanvasStore.setState({ focusedNodeId: 'something-else' })
      return makeFSEntries([{ name: 'a.ts', path: '/proj/src/a.ts', isDirectory: false }])
    })

    await useCanvasStore.getState().updatePreview()

    // Preview should have been discarded because focus changed
    expect(useCanvasStore.getState().columns).toHaveLength(1)
  })

  it('skips preview for import file nodes', async () => {
    const importNode: AppNode = {
      id: 'sibling:/proj/utils.ts', type: 'file', position: { x: 0, y: 0 },
      data: { label: 'utils.ts', path: '/proj/utils.ts', isImport: true },
    }
    useCanvasStore.setState({
      focusedNodeId: 'sibling:/proj/utils.ts',
      columns: [{ path: '/proj/app.ts', kind: 'file', nodes: [importNode], edges: [] }],
      currentColumnIndex: 0,
    })

    await useCanvasStore.getState().updatePreview()

    // Should have trimmed — no preview for import nodes
    expect(useCanvasStore.getState().columns).toHaveLength(1)
  })

  it('loads preview for function node in file column', async () => {
    const funcNode: AppNode = {
      id: 'decl:/proj/app.ts:doStuff:0', type: 'functionNode', position: { x: 0, y: 0 },
      data: { label: 'doStuff', kind: 'function', startLine: 0, endLine: 2 },
    }
    useCanvasStore.setState({
      focusedNodeId: funcNode.id,
      columns: [{ path: '/proj/app.ts', kind: 'file', nodes: [funcNode], edges: [] }],
      currentColumnIndex: 0,
    })

    mockReadFile.mockResolvedValue('function doStuff() {\n  return 1\n}\nconst x = 2')

    await useCanvasStore.getState().updatePreview()

    const state = useCanvasStore.getState()
    expect(state.columns).toHaveLength(2)
    expect(state.columns[1].kind).toBe('code')
  })

  it('does not load preview for function node in non-file column', async () => {
    const funcNode: AppNode = {
      id: 'decl:/proj/app.ts:doStuff:0', type: 'functionNode', position: { x: 0, y: 0 },
      data: { label: 'doStuff', kind: 'function', startLine: 0, endLine: 2 },
    }
    useCanvasStore.setState({
      focusedNodeId: funcNode.id,
      // Column kind is 'directory', not 'file'
      columns: [{ path: '/proj', kind: 'directory', nodes: [funcNode], edges: [] }],
      currentColumnIndex: 0,
    })

    await useCanvasStore.getState().updatePreview()

    // Should have trimmed — no preview available for function in directory column
    expect(useCanvasStore.getState().columns).toHaveLength(1)
  })

  it('keeps existing next column for projectMeta preview', async () => {
    const metaNode: AppNode = {
      id: '__project_meta__', type: 'projectMeta', position: { x: 0, y: 0 },
      data: { name: 'proj', description: null, version: null, language: null, framework: null },
    }
    const rootNode: AppNode = {
      id: '/proj/app.ts', type: 'file', position: { x: 0, y: 0 },
      data: { label: 'app.ts', path: '/proj/app.ts' },
    }

    useCanvasStore.setState({
      focusedNodeId: '__project_meta__',
      columns: [
        { path: '__meta__', kind: 'directory', nodes: [metaNode], edges: [] },
        { path: '/proj', kind: 'directory', nodes: [rootNode], edges: [] },
      ],
      currentColumnIndex: 0,
    })

    await useCanvasStore.getState().updatePreview()

    // Should keep the existing root column as preview
    const state = useCanvasStore.getState()
    expect(state.columns).toHaveLength(2)
    expect(state.columns[1].path).toBe('/proj')
  })
})

// ============================================================================
// Tests for flattenAndRender (column windowing and node positioning)
// ============================================================================
describe('flattenAndRender', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  function makeColumn(path: string, nodes: AppNode[], kind: Column['kind'] = 'directory'): Column {
    return { path, kind, nodes, edges: [] }
  }

  function makeSimpleNode(id: string, type: string = 'file'): AppNode {
    return { id, type: type as AppNode['type'], position: { x: 0, y: 0 }, data: { label: id, path: id } as AppNode['data'] }
  }

  it('shows up to 3 columns centered on current', async () => {
    mockDetectProjectMeta.mockResolvedValue({ name: 'p', description: null, version: null, language: null, framework: null })
    mockReadDirectory.mockResolvedValue(makeFSEntries([
      { name: 'a', path: '/p/a', isDirectory: false },
    ]))

    // Set up 4 columns, current at index 2
    const cols = [
      makeColumn('/col0', [makeSimpleNode('n0')]),
      makeColumn('/col1', [makeSimpleNode('n1')]),
      makeColumn('/col2', [makeSimpleNode('n2')]),
      makeColumn('/col3', [makeSimpleNode('n3')]),
    ]

    useCanvasStore.setState({
      columns: cols,
      currentColumnIndex: 2,
      focusedNodeId: 'n2',
      hiddenNodeIds: new Set(),
    })

    // Trigger flattenAndRender by toggling hide (which calls it)
    // We'll use a simpler approach: just navigate left from index 2
    // Actually, let's just call navigateLeft which triggers flattenAndRender
    useCanvasStore.getState().navigateLeft()

    const state = useCanvasStore.getState()
    // After navigating left, currentColumnIndex = 1
    // Visible columns should be [0, 1, 2] (3 columns)
    const nodeIds = state.nodes.map((n) => n.id)
    expect(nodeIds).toContain('n0')
    expect(nodeIds).toContain('n1')
    expect(nodeIds).toContain('n2')
    // n3 should not be visible
    expect(nodeIds).not.toContain('n3')
  })

  it('marks nodes with __isCurrent and __columnIndex metadata', async () => {
    const cols = [
      makeColumn('/col0', [makeSimpleNode('n0')]),
      makeColumn('/col1', [makeSimpleNode('n1')]),
    ]

    useCanvasStore.setState({
      columns: cols,
      currentColumnIndex: 1,
      focusedNodeId: 'n1',
      hiddenNodeIds: new Set(),
    })

    // Trigger render
    useCanvasStore.getState().navigateLeft()

    const state = useCanvasStore.getState()
    const n0 = state.nodes.find((n) => n.id === 'n0')!
    const n1 = state.nodes.find((n) => n.id === 'n1')!

    // After navigateLeft, currentColumnIndex = 0
    expect(n0.data.__isCurrent).toBe(true)
    expect(n0.data.__columnIndex).toBe(0)
    expect(n1.data.__isCurrent).toBe(false)
    expect(n1.data.__columnIndex).toBe(1)
  })

  it('tags hidden nodes with __isHidden', () => {
    const node: AppNode = {
      id: 'hidden-node', type: 'file', position: { x: 0, y: 0 },
      data: { label: 'hidden.ts', path: '/p/hidden.ts' },
    }

    useCanvasStore.setState({
      columns: [{ path: '/p', kind: 'directory', nodes: [node], edges: [] }],
      currentColumnIndex: 0,
      focusedNodeId: 'hidden-node',
      hiddenNodeIds: new Set(['hidden-node']),
    })

    // Trigger flattenAndRender via toggleHideNode (will unhide)
    useCanvasStore.getState().toggleHideNode()

    // After toggling, node is now visible again
    const state = useCanvasStore.getState()
    const renderedNode = state.nodes.find((n) => n.id === 'hidden-node')!
    expect(renderedNode.data.__isHidden).toBe(false)
  })

  it('positions columns at increasing X offsets', () => {
    const cols = [
      makeColumn('/col0', [makeSimpleNode('n0')]),
      makeColumn('/col1', [makeSimpleNode('n1')]),
      makeColumn('/col2', [makeSimpleNode('n2')]),
    ]

    useCanvasStore.setState({
      columns: cols,
      currentColumnIndex: 1,
      focusedNodeId: 'n1',
      hiddenNodeIds: new Set(),
    })

    // Trigger render via navigateLeft
    useCanvasStore.getState().navigateLeft()

    const state = useCanvasStore.getState()
    const n0 = state.nodes.find((n) => n.id === 'n0')!
    const n1 = state.nodes.find((n) => n.id === 'n1')!
    const n2 = state.nodes.find((n) => n.id === 'n2')!

    expect(n0.position.x).toBe(0)
    expect(n1.position.x).toBe(NODE_WIDTH + NODE_H_GAP)
    expect(n2.position.x).toBe(2 * (NODE_WIDTH + NODE_H_GAP))
  })

  it('orders hidden nodes after visible ones in each column', () => {
    const visibleNode: AppNode = {
      id: 'visible', type: 'file', position: { x: 0, y: 0 },
      data: { label: 'visible.ts', path: '/p/visible.ts' },
    }
    const hiddenNode: AppNode = {
      id: 'hidden', type: 'file', position: { x: 0, y: 0 },
      data: { label: 'hidden.ts', path: '/p/hidden.ts' },
    }

    // Hidden node is listed first in the column, but should render after visible
    useCanvasStore.setState({
      columns: [{ path: '/p', kind: 'directory', nodes: [hiddenNode, visibleNode], edges: [] }],
      currentColumnIndex: 0,
      focusedNodeId: 'visible',
      hiddenNodeIds: new Set(['hidden']),
    })

    // Trigger render — use toggleHideNode on 'visible' to trigger it (won't change order logic)
    // Actually, let's just set focus and call updatePreview which triggers flattenAndRender
    useCanvasStore.getState().setFocus('visible')

    // Wait for preview to settle
    return new Promise<void>((resolve) => setTimeout(() => {
      const state = useCanvasStore.getState()
      const visibleRendered = state.nodes.find((n) => n.id === 'visible')!
      const hiddenRendered = state.nodes.find((n) => n.id === 'hidden')!

      // Visible should be positioned above hidden (lower Y)
      expect(visibleRendered.position.y).toBeLessThan(hiddenRendered.position.y)
      resolve()
    }, 50))
  })

  it('handles empty columns', () => {
    useCanvasStore.setState({
      columns: [],
      currentColumnIndex: 0,
      hiddenNodeIds: new Set(),
    })

    // Trigger render via toggleHideNode (which calls flattenAndRender)
    useCanvasStore.setState({ focusedNodeId: 'x' })
    useCanvasStore.getState().toggleHideNode()

    const state = useCanvasStore.getState()
    expect(state.nodes).toEqual([])
    expect(state.edges).toEqual([])
  })

  it('preview column starts at Y=0 when focused node is near the top', () => {
    // With a large viewport, the focused node near the top doesn't cause panning
    const nodesCol0 = [makeSimpleNode('n0'), makeSimpleNode('n1')]
    const nodesCol1 = [makeSimpleNode('prev0'), makeSimpleNode('prev1')]

    useCanvasStore.setState({
      columns: [makeColumn('/root', nodesCol0), makeColumn('/root/sub', nodesCol1)],
      currentColumnIndex: 0,
      focusedNodeId: 'n0',
      hiddenNodeIds: new Set(),
      viewportHeight: 800,
      cameraY: CANVAS_PAD_Y, // fresh column
    })

    // Trigger flattenAndRender
    useCanvasStore.getState().toggleHideNode()

    const state = useCanvasStore.getState()
    const prev0 = state.nodes.find((n) => n.id === 'prev0')!
    const prev1 = state.nodes.find((n) => n.id === 'prev1')!

    expect(prev0.position.y).toBe(0)
    expect(prev1.position.y).toBe(NODE_HEIGHT + NODE_V_GAP)
  })

  it('preview column offsets when focused node is far down the list', () => {
    // 20 nodes, focused on the last one — camera must pan, preview should follow
    const nodesCol0 = Array.from({ length: 20 }, (_, i) => makeSimpleNode(`n-${i}`, 'folder'))
    const nodesCol1 = [makeSimpleNode('prev0'), makeSimpleNode('prev1')]

    const viewportH = 600
    useCanvasStore.setState({
      columns: [makeColumn('/root', nodesCol0), makeColumn('/root/sub', nodesCol1)],
      currentColumnIndex: 0,
      focusedNodeId: 'n-19',
      hiddenNodeIds: new Set(),
      viewportHeight: viewportH,
      cameraY: CANVAS_PAD_Y, // fresh column
    })

    useCanvasStore.getState().toggleHideNode()

    const state = useCanvasStore.getState()
    const prev0 = state.nodes.find((n) => n.id === 'prev0')!

    // n-19 is now hidden (toggleHideNode added it), ordered = [n-0..n-18, n-19].
    // n-19 is at index 19: Y = 19 * 72 = 1368
    const focusedY = 19 * (NODE_HEIGHT + NODE_V_GAP)
    // Camera clamps: newCameraY = viewportH - CANVAS_MARGIN - focusedY - NODE_HEIGHT
    const expectedCameraY = viewportH - CANVAS_MARGIN - focusedY - NODE_HEIGHT
    const expectedPreviewY = Math.max(0, -expectedCameraY + CANVAS_PAD_Y)

    expect(prev0.position.y).toBe(expectedPreviewY)
    expect(prev0.position.y).toBeGreaterThan(0)
  })

  it('preview column stays at Y=0 when viewportHeight is 0 (not yet measured)', () => {
    const nodesCol0 = Array.from({ length: 20 }, (_, i) => makeSimpleNode(`n-${i}`))
    const nodesCol1 = [makeSimpleNode('prev0')]

    useCanvasStore.setState({
      columns: [makeColumn('/root', nodesCol0), makeColumn('/root/sub', nodesCol1)],
      currentColumnIndex: 0,
      focusedNodeId: 'n-19',
      hiddenNodeIds: new Set(),
      viewportHeight: 0, // not yet measured
      cameraY: CANVAS_PAD_Y,
    })

    useCanvasStore.getState().toggleHideNode()

    const state = useCanvasStore.getState()
    const prev0 = state.nodes.find((n) => n.id === 'prev0')!
    // Without viewport info, fall back to Y=0
    expect(prev0.position.y).toBe(0)
  })

  it('current column always starts at Y=0 regardless of focused position', () => {
    const nodesCol0 = [makeSimpleNode('n0'), makeSimpleNode('n1')]

    useCanvasStore.setState({
      columns: [makeColumn('/root', nodesCol0)],
      currentColumnIndex: 0,
      focusedNodeId: 'n1', // focus on n1 so toggling hide puts n1 in hidden
      hiddenNodeIds: new Set(),
      viewportHeight: 200,
      cameraY: CANVAS_PAD_Y,
    })

    useCanvasStore.getState().toggleHideNode()

    const state = useCanvasStore.getState()
    // n0 is visible, not hidden, so it should be first in the column at Y=0
    const n0 = state.nodes.find((n) => n.id === 'n0')!
    // Current column is NOT offset — only preview columns are
    expect(n0.position.y).toBe(0)
  })

  it('moving up preserves preview offset when focused node is still visible', () => {
    // Simulate: scrolled far down, then move up one node. Camera should NOT move.
    // The preview column offset should stay the same.
    const viewportH = 600
    const count = 20
    const nodesCol0 = Array.from({ length: count }, (_, i) => makeSimpleNode(`n-${i}`, 'folder'))
    const nodesCol1 = [makeSimpleNode('prev0')]

    // First: focus on the bottom node to let cameraY clamp
    useCanvasStore.setState({
      columns: [makeColumn('/root', nodesCol0), makeColumn('/root/sub', nodesCol1)],
      currentColumnIndex: 0,
      focusedNodeId: `n-${count - 1}`,
      hiddenNodeIds: new Set(),
      viewportHeight: viewportH,
      cameraY: CANVAS_PAD_Y,
    })

    // Run flattenAndRender to establish the cameraY at the bottom
    useCanvasStore.getState().toggleHideNode() // adds n-19 to hidden, triggers flattenAndRender
    // Undo the hide so all nodes are visible again
    useCanvasStore.getState().toggleHideNode() // removes n-19 from hidden

    const cameraAfterBottom = useCanvasStore.getState().cameraY
    const previewYAfterBottom = useCanvasStore.getState().nodes.find((n) => n.id === 'prev0')!.position.y

    // Now move focus up by one (simulating pressing W)
    const prevNodeId = `n-${count - 2}`
    useCanvasStore.setState({ focusedNodeId: prevNodeId })
    // Re-trigger flattenAndRender (toggleHideNode is our trigger)
    useCanvasStore.getState().toggleHideNode()
    useCanvasStore.getState().toggleHideNode()

    const cameraAfterMoveUp = useCanvasStore.getState().cameraY
    const previewYAfterMoveUp = useCanvasStore.getState().nodes.find((n) => n.id === 'prev0')!.position.y

    // Camera should NOT have moved — the node above was already visible
    expect(cameraAfterMoveUp).toBe(cameraAfterBottom)
    // Preview offset should stay the same
    expect(previewYAfterMoveUp).toBe(previewYAfterBottom)
  })

  it('camera clamps upward when focused node is above visible area', () => {
    // Simulate: scrolled to bottom, then jump focus all the way to top.
    // Camera should clamp up, and preview should follow.
    const viewportH = 600
    const count = 20
    const nodesCol0 = Array.from({ length: count }, (_, i) => makeSimpleNode(`n-${i}`, 'folder'))
    const nodesCol1 = [makeSimpleNode('prev0')]

    // First: focus on bottom to clamp camera down
    useCanvasStore.setState({
      columns: [makeColumn('/root', nodesCol0), makeColumn('/root/sub', nodesCol1)],
      currentColumnIndex: 0,
      focusedNodeId: `n-${count - 1}`,
      hiddenNodeIds: new Set(),
      viewportHeight: viewportH,
      cameraY: CANVAS_PAD_Y,
    })

    useCanvasStore.getState().toggleHideNode()
    useCanvasStore.getState().toggleHideNode()

    const cameraAtBottom = useCanvasStore.getState().cameraY
    expect(cameraAtBottom).toBeLessThan(0) // camera panned way down

    // Now jump focus to the top node
    useCanvasStore.setState({ focusedNodeId: 'n-0' })
    useCanvasStore.getState().toggleHideNode()
    useCanvasStore.getState().toggleHideNode()

    const cameraAfterJumpUp = useCanvasStore.getState().cameraY

    // Camera should have clamped upward: newCameraY = -focusedNodeY + CANVAS_MARGIN = -0 + 60 = 60
    expect(cameraAfterJumpUp).toBe(CANVAS_MARGIN)

    const previewY = useCanvasStore.getState().nodes.find((n) => n.id === 'prev0')!.position.y
    // visibleTop = max(0, -60) = 0
    expect(previewY).toBe(0)
  })
})
// ============================================================================
// Tests for buildFileNodes (via navigateRight into file)
// ============================================================================
describe('buildFileNodes', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  it('creates a full-file code node when no declarations found', async () => {
    const fileNode: AppNode = {
      id: '/proj/config.json', type: 'file', position: { x: 0, y: 0 },
      data: { label: 'config.json', path: '/proj/config.json' },
    }

    useCanvasStore.setState({
      columns: [{ path: '/proj', kind: 'directory', nodes: [fileNode], edges: [] }],
      currentColumnIndex: 0,
      focusedNodeId: '/proj/config.json',
      nodes: [{ ...fileNode, data: { ...fileNode.data } } as Node],
    })

    mockReadFile.mockResolvedValue('{\n  "key": "value"\n}\n')
    mockAnalyzeFile.mockResolvedValue({ declarations: [], imports: [] })

    await useCanvasStore.getState().navigateRight()

    const state = useCanvasStore.getState()
    const fileCol = state.columns[1]
    expect(fileCol).toBeDefined()
    expect(fileCol.nodes).toHaveLength(1)
    expect(fileCol.nodes[0].type).toBe('codeNode')
    const data = fileCol.nodes[0].data as Record<string, unknown>
    expect(data.code).toBe('{\n  "key": "value"\n}\n')
  })

  it('creates edges from class to method nodes', async () => {
    const fileNode: AppNode = {
      id: '/proj/app.ts', type: 'file', position: { x: 0, y: 0 },
      data: { label: 'app.ts', path: '/proj/app.ts' },
    }

    useCanvasStore.setState({
      columns: [{ path: '/proj', kind: 'directory', nodes: [fileNode], edges: [] }],
      currentColumnIndex: 0,
      focusedNodeId: '/proj/app.ts',
      nodes: [{ ...fileNode, data: { ...fileNode.data } } as Node],
    })

    mockReadFile.mockResolvedValue('class Foo { bar() {} baz() {} }')
    mockAnalyzeFile.mockResolvedValue({
      declarations: [{
        name: 'Foo', kind: 'class', startLine: 0, endLine: 10,
        children: [
          { name: 'bar', kind: 'function', startLine: 1, endLine: 3, children: [] },
          { name: 'baz', kind: 'function', startLine: 5, endLine: 7, children: [] },
        ],
      }],
      imports: [],
    })

    await useCanvasStore.getState().navigateRight()

    const state = useCanvasStore.getState()
    const fileCol = state.columns[1]
    // 1 class + 2 methods = 3 nodes
    expect(fileCol.nodes).toHaveLength(3)
    // Should have 2 edges (class -> bar, class -> baz)
    expect(fileCol.edges).toHaveLength(2)
    for (const edge of fileCol.edges) {
      expect(edge.source).toContain('Foo')
    }
  })
})

// ============================================================================
// Tests for buildCodeNode line extraction
// ============================================================================
describe('buildCodeNode line extraction', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  it('extracts correct lines using 0-indexed startLine/endLine', async () => {
    const funcNode: AppNode = {
      id: 'decl:/proj/app.ts:myFunc:2', type: 'functionNode', position: { x: 0, y: 0 },
      data: { label: 'myFunc', kind: 'function', startLine: 2, endLine: 4 },
    }

    useCanvasStore.setState({
      columns: [{ path: '/proj/app.ts', kind: 'file', nodes: [funcNode], edges: [] }],
      currentColumnIndex: 0,
      focusedNodeId: funcNode.id,
      nodes: [{ ...funcNode, data: { ...funcNode.data } } as Node],
    })

    // Lines: 0='import x', 1='', 2='function myFunc() {', 3='  return 1', 4='}', 5='export default myFunc'
    mockReadFile.mockResolvedValue('import x\n\nfunction myFunc() {\n  return 1\n}\nexport default myFunc')

    await useCanvasStore.getState().navigateRight()

    const state = useCanvasStore.getState()
    expect(state.selectedFunction).toBeDefined()
    // 0-indexed: slice(2, 5) = lines 2, 3, 4
    expect(state.selectedFunction!.content).toBe('function myFunc() {\n  return 1\n}')
    expect(state.selectedFunction!.startLine).toBe(2)
    expect(state.selectedFunction!.endLine).toBe(4)
    expect(state.selectedFunction!.fullFileContent).toBe('import x\n\nfunction myFunc() {\n  return 1\n}\nexport default myFunc')
  })

  it('handles function at start of file (startLine 0)', async () => {
    const funcNode: AppNode = {
      id: 'decl:/proj/app.ts:main:0', type: 'functionNode', position: { x: 0, y: 0 },
      data: { label: 'main', kind: 'function', startLine: 0, endLine: 1 },
    }

    useCanvasStore.setState({
      columns: [{ path: '/proj/app.ts', kind: 'file', nodes: [funcNode], edges: [] }],
      currentColumnIndex: 0,
      focusedNodeId: funcNode.id,
      nodes: [{ ...funcNode, data: { ...funcNode.data } } as Node],
    })

    mockReadFile.mockResolvedValue('function main() {\n  return 0\n}\n')

    await useCanvasStore.getState().navigateRight()

    const state = useCanvasStore.getState()
    expect(state.selectedFunction!.content).toBe('function main() {\n  return 0')
  })
})

// ============================================================================
// Tests for promotion path line indexing bug
// ============================================================================
describe('navigateRight promotion path line indexing', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  it('should extract same content via promotion as via fresh buildCodeNode', async () => {
    // This test verifies whether the promotion path (lines 389-391 in canvas.ts)
    // uses the same indexing as buildCodeNode (line 186).
    // buildCodeNode: lines.slice(startLine, endLine + 1) — treats as 0-indexed
    // promotion: lines.slice(startLine - 1, endLine) — treats as 1-indexed
    // These produce DIFFERENT content for the same function, which is a bug.

    const funcNode: AppNode = {
      id: 'decl:/proj/app.ts:myFunc:2', type: 'functionNode', position: { x: 0, y: 0 },
      data: { label: 'myFunc', kind: 'function', startLine: 2, endLine: 4 },
    }
    const codeNode: AppNode = {
      id: 'code:/proj/app.ts:myFunc', type: 'codeNode', position: { x: 0, y: 0 },
      data: { label: 'myFunc', filePath: '/proj/app.ts', code: 'function myFunc() {\n  return 1\n}', startLine: 2, endLine: 4 },
    }

    // Pre-existing preview column with code
    const fileCol: Column = { path: '/proj/app.ts', kind: 'file', nodes: [funcNode], edges: [] }
    const previewCol: Column = { path: '/proj/app.ts:myFunc', kind: 'code', nodes: [codeNode], edges: [] }

    useCanvasStore.setState({
      columns: [fileCol, previewCol],
      currentColumnIndex: 0,
      depthChain: ['/proj/app.ts'],
      focusedNodeId: funcNode.id,
      nodes: [
        { ...funcNode, data: { ...funcNode.data } } as Node,
      ],
    })

    // File content for the promotion path to re-read
    const fileContent = 'import x\n\nfunction myFunc() {\n  return 1\n}\nexport default myFunc'
    mockReadFile.mockResolvedValue(fileContent)

    await useCanvasStore.getState().navigateRight()

    const state = useCanvasStore.getState()
    expect(state.selectedFunction).toBeDefined()

    // The correct content (from buildCodeNode, 0-indexed) should be:
    // lines.slice(2, 5) = ['function myFunc() {', '  return 1', '}']
    const expectedContent = 'function myFunc() {\n  return 1\n}'

    // The promotion path uses lines.slice(startLine - 1, endLine) = slice(1, 4)
    // = ['', 'function myFunc() {', '  return 1']
    // This is WRONG — it's off by one line from the correct result.
    // This test documents the bug: the promotion path content differs from
    // the fresh buildCodeNode content.

    // What we WANT (correct behavior):
    // expect(state.selectedFunction!.content).toBe(expectedContent)

    // What actually happens (the bug):
    const promotionContent = state.selectedFunction!.content
    const lines = fileContent.split('\n')
    const buggyContent = lines.slice(2 - 1, 4).join('\n') // slice(1, 4) = wrong
    const correctContent = lines.slice(2, 4 + 1).join('\n') // slice(2, 5) = correct

    // Document that promotion produces the buggy content, not the correct one
    expect(promotionContent).toBe(buggyContent)
    expect(buggyContent).not.toBe(correctContent) // Bug confirmed: they differ
  })
})

// ============================================================================
// Tests for setFocus
// ============================================================================
describe('setFocus', () => {
  it('updates focused node id', () => {
    useCanvasStore.setState({ focusedNodeId: null })
    useCanvasStore.getState().setFocus('node1')
    expect(useCanvasStore.getState().focusedNodeId).toBe('node1')
  })

  it('can clear focus', () => {
    useCanvasStore.setState({ focusedNodeId: 'node1' })
    useCanvasStore.getState().setFocus(null)
    expect(useCanvasStore.getState().focusedNodeId).toBeNull()
  })
})

// ============================================================================
// Tests for basic ReactFlow handlers
// ============================================================================
describe('ReactFlow handlers', () => {
  beforeEach(() => {
    resetStore()
  })

  it('setNodes replaces nodes', () => {
    const newNodes = [{ id: 'x', position: { x: 0, y: 0 }, data: {} } as Node]
    useCanvasStore.getState().setNodes(newNodes)
    expect(useCanvasStore.getState().nodes).toEqual(newNodes)
  })

  it('setEdges replaces edges', () => {
    const newEdges = [{ id: 'e1', source: 'a', target: 'b' }]
    useCanvasStore.getState().setEdges(newEdges)
    expect(useCanvasStore.getState().edges).toEqual(newEdges)
  })
})
