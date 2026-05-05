import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NODE_WIDTH, NODE_HEIGHT, NODE_H_GAP, NODE_V_GAP_SMALL, CANVAS_PAD_Y, CANVAS_MARGIN } from '@/lib/constants'

const mockReadDirectory = vi.fn()
const mockReadFile = vi.fn()
const mockReadBinaryFile = vi.fn()

vi.mock('@/services/platform', () => ({
  getPlatform: () => ({
    fs: {
      readDirectory: mockReadDirectory,
      readFile: mockReadFile,
      readBinaryFile: mockReadBinaryFile,
    },
  }),
}))

import { useCanvasStore, type Column } from './canvas'
import type { AppNode } from '@/types/nodes'

function resetStore() {
  useCanvasStore.setState({
    nodes: [],
    edges: [],
    focusedNodeId: null,
    columns: [],
    currentColumnIndex: 0,
    depthChain: [],
    hiddenNodeIds: new Set(),
    rightFocusMemory: {},
    viewportHeight: 0,
    cameraY: CANVAS_PAD_Y,
  })
}

function makeFSEntries(entries: Array<{ name: string; path: string; isDirectory: boolean }>) {
  return entries
}

/** Build a positioned file node for position-only tests. */
function posNode(id: string, x: number, y: number): AppNode {
  return {
    id,
    type: 'file',
    position: { x, y },
    data: { label: id, path: `/${id}` },
  }
}

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


    await useCanvasStore.getState().initRoot('/proj')

    // Column 0 is the root directory column
    const dirCol = useCanvasStore.getState().columns[0]
    expect(dirCol).toBeDefined()
    const labels = dirCol.nodes.map((n) => n.data.label)
    expect(labels.indexOf('app.ts')).toBeLessThan(labels.indexOf('app.test.ts'))
    expect(labels.indexOf('utils.ts')).toBeLessThan(labels.indexOf('app.test.ts'))
  })

  it('sorts folders before files and test files last', async () => {
    mockReadDirectory.mockResolvedValue(makeFSEntries([
      { name: 'app.spec.ts', path: '/proj/app.spec.ts', isDirectory: false },
      { name: 'src', path: '/proj/src', isDirectory: true },
      { name: 'main.ts', path: '/proj/main.ts', isDirectory: false },
    ]))


    await useCanvasStore.getState().initRoot('/proj')

    const dirCol = useCanvasStore.getState().columns[0]
    const labels = dirCol.nodes.map((n) => n.data.label)
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


    await useCanvasStore.getState().initRoot('/p')

    const dirCol = useCanvasStore.getState().columns[0]
    const labels = dirCol.nodes.map((n) => n.data.label)
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


    await useCanvasStore.getState().initRoot('/p')

    const dirCol = useCanvasStore.getState().columns[0]
    const regular = dirCol.nodes.find((n) => n.data.label === 'app.ts')
    const test = dirCol.nodes.find((n) => n.data.label === 'app.test.ts')
    expect(regular?.type === 'file' && regular.data.isTestFile).toBeFalsy()
    expect(test?.type === 'file' && test.data.isTestFile).toBe(true)
  })
})

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


    await useCanvasStore.getState().initRoot('/p')

    const dirCol = useCanvasStore.getState().columns[0]
    const labels = dirCol.nodes.map((n) => n.data.label)
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


    await useCanvasStore.getState().initRoot('/p')

    const dirCol = useCanvasStore.getState().columns[0]
    const labels = dirCol.nodes.map((n) => n.data.label)
    expect(labels).toContain('.env')
    expect(labels).toContain('.gitignore')
    expect(labels).not.toContain('.hidden')
  })
})

describe('findVerticalNeighbor (via moveFocus)', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  it('moveFocus picks first node when no focus is set', () => {
    useCanvasStore.setState({
      nodes: [posNode('a', 0, 0), posNode('b', 0, 72)],
    })

    useCanvasStore.getState().moveFocus('down')
    expect(useCanvasStore.getState().focusedNodeId).toBe('a')
  })

  it('moveFocus moves focus down to next node in same column', () => {
    useCanvasStore.setState({
      nodes: [posNode('a', 0, 0), posNode('b', 0, 72), posNode('c', 0, 144)],
      focusedNodeId: 'a',
    })

    useCanvasStore.getState().moveFocus('down')
    expect(useCanvasStore.getState().focusedNodeId).toBe('b')
  })

  it('moveFocus moves focus up to previous node in same column', () => {
    useCanvasStore.setState({
      nodes: [posNode('a', 0, 0), posNode('b', 0, 72)],
      focusedNodeId: 'b',
    })

    useCanvasStore.getState().moveFocus('up')
    expect(useCanvasStore.getState().focusedNodeId).toBe('a')
  })

  it('moveFocus does nothing when at boundary (no neighbor)', () => {
    useCanvasStore.setState({
      nodes: [posNode('a', 0, 0)],
      focusedNodeId: 'a',
    })

    useCanvasStore.getState().moveFocus('up')
    expect(useCanvasStore.getState().focusedNodeId).toBe('a')
  })

  it('moveFocus ignores nodes in different X columns', () => {
    useCanvasStore.setState({
      nodes: [
        posNode('a', 0, 0),
        posNode('b', NODE_WIDTH + NODE_H_GAP, 72),
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
      nodes: [posNode('a', 0, 0), posNode('b', 0, 72), posNode('c', 0, 200)],
      focusedNodeId: 'a',
    })

    useCanvasStore.getState().moveFocus('down')
    expect(useCanvasStore.getState().focusedNodeId).toBe('b')
  })

  it('moveFocus wraps down from last node to first node in column', () => {
    useCanvasStore.setState({
      nodes: [posNode('a', 0, 0), posNode('b', 0, 72), posNode('c', 0, 144)],
      focusedNodeId: 'c',
    })

    useCanvasStore.getState().moveFocus('down')
    expect(useCanvasStore.getState().focusedNodeId).toBe('a')
  })

  it('moveFocus wraps up from first node to last node in column', () => {
    useCanvasStore.setState({
      nodes: [posNode('a', 0, 0), posNode('b', 0, 72), posNode('c', 0, 144)],
      focusedNodeId: 'a',
    })

    useCanvasStore.getState().moveFocus('up')
    expect(useCanvasStore.getState().focusedNodeId).toBe('c')
  })

  it('moveFocus wraps within own column only, not across columns', () => {
    useCanvasStore.setState({
      nodes: [
        posNode('a', 0, 0),
        posNode('b', 0, 72),
        posNode('c', NODE_WIDTH + NODE_H_GAP, 0),
        posNode('d', NODE_WIDTH + NODE_H_GAP, 72),
      ],
      focusedNodeId: 'b',
    })

    useCanvasStore.getState().moveFocus('down')
    // Should wrap to 'a' (top of same column), not jump to 'c' or 'd'
    expect(useCanvasStore.getState().focusedNodeId).toBe('a')
  })
})

describe('initRoot', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  it('creates root directory column', async () => {
    mockReadDirectory.mockResolvedValue(makeFSEntries([
      { name: 'src', path: '/proj/src', isDirectory: true },
      { name: 'main.ts', path: '/proj/main.ts', isDirectory: false },
    ]))

    await useCanvasStore.getState().initRoot('/proj')

    const state = useCanvasStore.getState()
    expect(state.columns).toHaveLength(1)
    expect(state.columns[0].path).toBe('/proj')
    expect(state.columns[0].kind).toBe('directory')
    expect(state.currentColumnIndex).toBe(0)
    expect(state.depthChain).toEqual(['/proj'])
  })

  it('sets focusedNodeId to first directory node', async () => {

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

    mockReadDirectory.mockResolvedValue([])

    await useCanvasStore.getState().initRoot('/empty')

    const state = useCanvasStore.getState()
    expect(state.columns[0].nodes).toHaveLength(0)
    expect(state.focusedNodeId).toBeNull()
  })

  it('handles errors gracefully', async () => {
    mockReadDirectory.mockRejectedValue(new Error('network error'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await useCanvasStore.getState().initRoot('/proj')

    // Should not throw, just log
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('renders flat nodes and edges via flattenAndRender', async () => {

    mockReadDirectory.mockResolvedValue(makeFSEntries([
      { name: 'a.ts', path: '/proj/a.ts', isDirectory: false },
      { name: 'b.ts', path: '/proj/b.ts', isDirectory: false },
    ]))

    await useCanvasStore.getState().initRoot('/proj')

    const state = useCanvasStore.getState()
    // Should have flat nodes from the root directory column
    expect(state.nodes.length).toBeGreaterThan(0)
    // Root directory has 2 nodes
    expect(state.nodes).toHaveLength(2)
  })
})

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
      nodes: [posNode('other', 0, 0)],
    })
    await useCanvasStore.getState().navigateRight()
    expect(useCanvasStore.getState().currentColumnIndex).toBe(0)
  })

  it('navigates into a folder', async () => {

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
    expect(state.currentColumnIndex).toBe(1)
    expect(state.depthChain).toContain('/proj/src')
  })

  it('does not advance into a file — files are previewed in-place', async () => {
    mockReadDirectory.mockResolvedValue(makeFSEntries([
      { name: 'app.ts', path: '/proj/app.ts', isDirectory: false },
    ]))

    await useCanvasStore.getState().initRoot('/proj')
    mockReadFile.mockResolvedValue('const x = 1;\n'.repeat(25))

    await useCanvasStore.getState().navigateRight()

    const state = useCanvasStore.getState()
    expect(state.currentColumnIndex).toBe(0)
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
        { ...folderNode, data: { ...folderNode.data } } as AppNode,
        { ...previewFileNode, data: { ...previewFileNode.data } } as AppNode,
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
        { ...parentNode, data: { ...parentNode.data } } as AppNode,
        { ...childNode, data: { ...childNode.data } } as AppNode,
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
      nodes: [{ ...node1, data: { ...node1.data } } as AppNode],
    })

    useCanvasStore.getState().navigateLeft()

    expect(useCanvasStore.getState().focusedNodeId).toBe('node1')
  })

  it('records the focused child in rightFocusMemory', () => {
    const folderNode: AppNode = {
      id: '/proj/src', type: 'folder', position: { x: 0, y: 0 },
      data: { label: 'src', path: '/proj/src', isDirectory: true as const },
    }
    const childA: AppNode = {
      id: '/proj/src/a.ts', type: 'file', position: { x: 0, y: 0 },
      data: { label: 'a.ts', path: '/proj/src/a.ts' },
    }
    const childB: AppNode = {
      id: '/proj/src/b.ts', type: 'file', position: { x: 0, y: 0 },
      data: { label: 'b.ts', path: '/proj/src/b.ts' },
    }

    useCanvasStore.setState({
      columns: [
        { path: '/proj', kind: 'directory', nodes: [folderNode], edges: [] },
        { path: '/proj/src', kind: 'directory', nodes: [childA, childB], edges: [] },
      ],
      currentColumnIndex: 1,
      focusedNodeId: '/proj/src/b.ts',
      nodes: [
        { ...folderNode, data: { ...folderNode.data } } as AppNode,
        { ...childA, data: { ...childA.data } } as AppNode,
        { ...childB, data: { ...childB.data } } as AppNode,
      ],
    })

    useCanvasStore.getState().navigateLeft()

    expect(useCanvasStore.getState().rightFocusMemory).toEqual({
      '/proj/src': '/proj/src/b.ts',
    })
  })

})

describe('rightFocusMemory', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  it('navigateRight restores remembered focus from a preview promotion', async () => {
    const folderNode: AppNode = {
      id: '/proj/src', type: 'folder', position: { x: 0, y: 0 },
      data: { label: 'src', path: '/proj/src', isDirectory: true as const },
    }
    const childA: AppNode = {
      id: '/proj/src/a.ts', type: 'file', position: { x: 0, y: 0 },
      data: { label: 'a.ts', path: '/proj/src/a.ts' },
    }
    const childB: AppNode = {
      id: '/proj/src/b.ts', type: 'file', position: { x: 0, y: 0 },
      data: { label: 'b.ts', path: '/proj/src/b.ts' },
    }

    useCanvasStore.setState({
      columns: [
        { path: '/proj', kind: 'directory', nodes: [folderNode], edges: [] },
        { path: '/proj/src', kind: 'directory', nodes: [childA, childB], edges: [] },
      ],
      currentColumnIndex: 1,
      depthChain: ['/proj', '/proj/src'],
      focusedNodeId: '/proj/src/b.ts',
      nodes: [
        { ...folderNode, data: { ...folderNode.data } } as AppNode,
        { ...childA, data: { ...childA.data } } as AppNode,
        { ...childB, data: { ...childB.data } } as AppNode,
      ],
    })

    // Left: focus moves back to the parent, memory is saved.
    useCanvasStore.getState().navigateLeft()
    expect(useCanvasStore.getState().focusedNodeId).toBe('/proj/src')

    // Right: the preview column gets promoted; memory restores b.ts,
    // not the first node (a.ts).
    await useCanvasStore.getState().navigateRight()
    expect(useCanvasStore.getState().focusedNodeId).toBe('/proj/src/b.ts')
  })

  it('restores remembered focus from a fresh load when no preview exists', async () => {
    const folderNode: AppNode = {
      id: '/proj/src', type: 'folder', position: { x: 0, y: 0 },
      data: { label: 'src', path: '/proj/src', isDirectory: true as const },
    }

    useCanvasStore.setState({
      columns: [
        { path: '/proj', kind: 'directory', nodes: [folderNode], edges: [] },
      ],
      currentColumnIndex: 0,
      depthChain: ['/proj'],
      focusedNodeId: '/proj/src',
      nodes: [{ ...folderNode, data: { ...folderNode.data } } as AppNode],
      // Pre-seeded memory as if we had navigated left out of /proj/src earlier,
      // but without a preview column loaded (e.g., after a reset).
      rightFocusMemory: { '/proj/src': '/proj/src/b.ts' },
    })

    mockReadDirectory.mockResolvedValue(makeFSEntries([
      { name: 'a.ts', path: '/proj/src/a.ts', isDirectory: false },
      { name: 'b.ts', path: '/proj/src/b.ts', isDirectory: false },
    ]))

    await useCanvasStore.getState().navigateRight()

    expect(useCanvasStore.getState().focusedNodeId).toBe('/proj/src/b.ts')
  })

  it('falls back to first node when remembered id no longer exists', async () => {
    const folderNode: AppNode = {
      id: '/proj/src', type: 'folder', position: { x: 0, y: 0 },
      data: { label: 'src', path: '/proj/src', isDirectory: true as const },
    }

    useCanvasStore.setState({
      columns: [
        { path: '/proj', kind: 'directory', nodes: [folderNode], edges: [] },
      ],
      currentColumnIndex: 0,
      depthChain: ['/proj'],
      focusedNodeId: '/proj/src',
      nodes: [{ ...folderNode, data: { ...folderNode.data } } as AppNode],
      rightFocusMemory: { '/proj/src': '/proj/src/deleted.ts' },
    })

    mockReadDirectory.mockResolvedValue(makeFSEntries([
      { name: 'a.ts', path: '/proj/src/a.ts', isDirectory: false },
    ]))

    await useCanvasStore.getState().navigateRight()

    // deleted.ts is gone, so we fall back to the first node (a.ts).
    expect(useCanvasStore.getState().focusedNodeId).toBe('/proj/src/a.ts')
  })

  it('2L+2R round trip returns the user to the exact starting focus', async () => {
    // Three-level tree: /proj → /proj/src → /proj/src/inner → /proj/src/inner/deep.ts
    const srcFolder: AppNode = {
      id: '/proj/src', type: 'folder', position: { x: 0, y: 0 },
      data: { label: 'src', path: '/proj/src', isDirectory: true as const },
    }
    const innerFolder: AppNode = {
      id: '/proj/src/inner', type: 'folder', position: { x: 0, y: 0 },
      data: { label: 'inner', path: '/proj/src/inner', isDirectory: true as const },
    }
    const deepA: AppNode = {
      id: '/proj/src/inner/a.ts', type: 'file', position: { x: 0, y: 0 },
      data: { label: 'a.ts', path: '/proj/src/inner/a.ts' },
    }
    const deepB: AppNode = {
      id: '/proj/src/inner/b.ts', type: 'file', position: { x: 0, y: 0 },
      data: { label: 'b.ts', path: '/proj/src/inner/b.ts' },
    }

    useCanvasStore.setState({
      columns: [
        { path: '/proj', kind: 'directory', nodes: [srcFolder], edges: [] },
        { path: '/proj/src', kind: 'directory', nodes: [innerFolder], edges: [] },
        { path: '/proj/src/inner', kind: 'directory', nodes: [deepA, deepB], edges: [] },
      ],
      currentColumnIndex: 2,
      depthChain: ['/proj', '/proj/src', '/proj/src/inner'],
      focusedNodeId: '/proj/src/inner/b.ts',
      nodes: [
        { ...srcFolder, data: { ...srcFolder.data } } as AppNode,
        { ...innerFolder, data: { ...innerFolder.data } } as AppNode,
        { ...deepA, data: { ...deepA.data } } as AppNode,
        { ...deepB, data: { ...deepB.data } } as AppNode,
      ],
    })

    const store = useCanvasStore.getState

    // L: leave /proj/src/inner focused on b.ts → memory records it
    store().navigateLeft()
    expect(store().currentColumnIndex).toBe(1)
    expect(store().focusedNodeId).toBe('/proj/src/inner')

    // L: leave /proj/src focused on inner → memory records it
    store().navigateLeft()
    expect(store().currentColumnIndex).toBe(0)
    expect(store().focusedNodeId).toBe('/proj/src')

    // R: drill back into /proj/src, focus restored to 'inner'
    await store().navigateRight()
    expect(store().currentColumnIndex).toBe(1)
    expect(store().focusedNodeId).toBe('/proj/src/inner')

    // R: drill back into /proj/src/inner, focus restored to 'b.ts' (not 'a.ts')
    await store().navigateRight()
    expect(store().currentColumnIndex).toBe(2)
    expect(store().focusedNodeId).toBe('/proj/src/inner/b.ts')
  })

  it('initRoot wipes previously saved focus memory', async () => {
    useCanvasStore.setState({
      rightFocusMemory: { '/old/path': '/old/path/something.ts' },
    })

    mockReadDirectory.mockResolvedValue(makeFSEntries([
      { name: 'a.ts', path: '/proj/a.ts', isDirectory: false },
    ]))

    await useCanvasStore.getState().initRoot('/proj')

    expect(useCanvasStore.getState().rightFocusMemory).toEqual({})
  })
})

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

})

describe('flattenAndRender', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  function makeColumn(path: string, nodes: AppNode[], kind: Column['kind'] = 'directory'): Column {
    return { path, kind, nodes, edges: [] }
  }

  function makeSimpleNode(id: string, type: string = 'file'): AppNode {
    return { id, type: type as AppNode['type'], position: { x: 0, y: 0 }, data: { label: id, path: id } as AppNode['data'] } as AppNode
  }

  it('renders all columns regardless of current index', async () => {

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
    // All columns should be rendered (no windowing)
    const nodeIds = state.nodes.map((n) => n.id)
    expect(nodeIds).toContain('n0')
    expect(nodeIds).toContain('n1')
    expect(nodeIds).toContain('n2')
    expect(nodeIds).toContain('n3')
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
    expect(prev1.position.y).toBe(NODE_HEIGHT + NODE_V_GAP_SMALL)
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
    // n-19 is at index 19 (all folders, so small gap): Y = 19 * (56 + 4) = 1140
    const focusedY = 19 * (NODE_HEIGHT + NODE_V_GAP_SMALL)
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
      nodes: [{ ...fileNode, data: { ...fileNode.data } } as AppNode],
    })

    mockReadFile.mockResolvedValue('{\n  "key": "value"\n}\n')

    await useCanvasStore.getState().updatePreview()

    const state = useCanvasStore.getState()
    const fileCol = state.columns[1]
    expect(fileCol).toBeDefined()
    expect(fileCol.kind).toBe('file')
    expect(fileCol.nodes).toHaveLength(1)
    const firstNode = fileCol.nodes[0]
    expect(firstNode.type).toBe('codeNode')
    if (firstNode.type === 'codeNode') {
      expect(firstNode.data.code).toBe('{\n  "key": "value"\n}\n')
    }
  })

})

describe('focusFileByPath', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  it('navigates columns to the parent directory of a nested file and focuses it', async () => {
    mockReadDirectory.mockImplementation((path: string) => {
      if (path === '/proj') {
        return Promise.resolve(makeFSEntries([
          { name: 'src', path: '/proj/src', isDirectory: true },
        ]))
      }
      if (path === '/proj/src') {
        return Promise.resolve(makeFSEntries([
          { name: 'foo.ts', path: '/proj/src/foo.ts', isDirectory: false },
        ]))
      }
      return Promise.resolve([])
    })
    mockReadFile.mockResolvedValue('file content\n')

    await useCanvasStore.getState().initRoot('/proj')

    await useCanvasStore.getState().focusFileByPath('src/foo.ts')

    const { columns, currentColumnIndex, focusedNodeId } = useCanvasStore.getState()
    expect(columns.length).toBeGreaterThanOrEqual(2)
    expect(columns[currentColumnIndex].path).toBe('/proj/src')
    expect(focusedNodeId).toBe('/proj/src/foo.ts')
  })

  it('focuses the parent directory when the file is deleted from disk', async () => {
    mockReadDirectory.mockImplementation((path: string) => {
      if (path === '/proj') {
        return Promise.resolve(makeFSEntries([
          { name: 'src', path: '/proj/src', isDirectory: true },
        ]))
      }
      if (path === '/proj/src') {
        return Promise.resolve([])
      }
      return Promise.resolve([])
    })

    await useCanvasStore.getState().initRoot('/proj')
    await useCanvasStore.getState().focusFileByPath('src/gone.ts')

    const { columns, currentColumnIndex, focusedNodeId } = useCanvasStore.getState()
    expect(columns[currentColumnIndex].path).toBe('/proj/src')
    expect(focusedNodeId).toBeNull()
  })
})

