import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// Mock web-tree-sitter to avoid WASM loading
vi.mock('web-tree-sitter', () => ({
  Parser: { init: vi.fn() },
  Query: vi.fn(),
  Language: { load: vi.fn() },
}))

// Mock platform
vi.mock('@/services/platform', () => ({
  getPlatform: () => ({
    fs: {
      readDirectory: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue(''),
    },
  }),
}))

// Mock projectMeta
vi.mock('@/services/projectMeta', () => ({
  detectProjectMeta: vi.fn().mockResolvedValue({
    name: 'test', description: null, version: null, language: null, framework: null,
  }),
}))

// Mock treesitter
vi.mock('@/services/treesitter', () => ({
  analyzeFile: vi.fn().mockResolvedValue({ declarations: [], imports: [] }),
}))

import { useCanvasKeyboard } from './useCanvasKeyboard'
import { useCanvasStore } from '@/store'

const FOCUS_GUARD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

describe('useCanvasKeyboard', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    // Reset store
    useCanvasStore.setState({
      nodes: [],
      edges: [],
      focusedNodeId: null,
      columns: [],
      currentColumnIndex: 0,
      depthChain: [],
      selectedFunction: null,
      hiddenNodeIds: new Set(),
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  function dispatchKey(key: string, element: HTMLElement = container) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    element.dispatchEvent(event)
  }

  it('sets tabindex on container if not set', () => {
    const ref = { current: container }
    renderHook(() => useCanvasKeyboard(ref))
    expect(container.getAttribute('tabindex')).toBe('0')
  })

  it('does not overwrite existing tabindex', () => {
    container.setAttribute('tabindex', '-1')
    const ref = { current: container }
    renderHook(() => useCanvasKeyboard(ref))
    expect(container.getAttribute('tabindex')).toBe('-1')
  })

  it('calls moveFocus("up") on W key', () => {
    const moveFocusSpy = vi.spyOn(useCanvasStore.getState(), 'moveFocus')
    const ref = { current: container }
    renderHook(() => useCanvasKeyboard(ref))

    dispatchKey('w')
    expect(moveFocusSpy).toHaveBeenCalledWith('up')
  })

  it('calls moveFocus("up") on ArrowUp key', () => {
    const moveFocusSpy = vi.spyOn(useCanvasStore.getState(), 'moveFocus')
    const ref = { current: container }
    renderHook(() => useCanvasKeyboard(ref))

    dispatchKey('ArrowUp')
    expect(moveFocusSpy).toHaveBeenCalledWith('up')
  })

  it('calls moveFocus("down") on S key', () => {
    const moveFocusSpy = vi.spyOn(useCanvasStore.getState(), 'moveFocus')
    const ref = { current: container }
    renderHook(() => useCanvasKeyboard(ref))

    dispatchKey('s')
    expect(moveFocusSpy).toHaveBeenCalledWith('down')
  })

  it('calls moveFocus("down") on ArrowDown key', () => {
    const moveFocusSpy = vi.spyOn(useCanvasStore.getState(), 'moveFocus')
    const ref = { current: container }
    renderHook(() => useCanvasKeyboard(ref))

    dispatchKey('ArrowDown')
    expect(moveFocusSpy).toHaveBeenCalledWith('down')
  })

  it('calls navigateLeft on A key', () => {
    const navigateLeftSpy = vi.spyOn(useCanvasStore.getState(), 'navigateLeft')
    const ref = { current: container }
    renderHook(() => useCanvasKeyboard(ref))

    dispatchKey('a')
    expect(navigateLeftSpy).toHaveBeenCalled()
  })

  it('calls navigateLeft on ArrowLeft key', () => {
    const navigateLeftSpy = vi.spyOn(useCanvasStore.getState(), 'navigateLeft')
    const ref = { current: container }
    renderHook(() => useCanvasKeyboard(ref))

    dispatchKey('ArrowLeft')
    expect(navigateLeftSpy).toHaveBeenCalled()
  })

  it('calls navigateRight on D key', () => {
    const navigateRightSpy = vi.spyOn(useCanvasStore.getState(), 'navigateRight')
    const ref = { current: container }
    renderHook(() => useCanvasKeyboard(ref))

    dispatchKey('d')
    expect(navigateRightSpy).toHaveBeenCalled()
  })

  it('calls navigateRight on ArrowRight key', () => {
    const navigateRightSpy = vi.spyOn(useCanvasStore.getState(), 'navigateRight')
    const ref = { current: container }
    renderHook(() => useCanvasKeyboard(ref))

    dispatchKey('ArrowRight')
    expect(navigateRightSpy).toHaveBeenCalled()
  })

  it('calls toggleHideNode on H key', () => {
    const toggleSpy = vi.spyOn(useCanvasStore.getState(), 'toggleHideNode')
    const ref = { current: container }
    renderHook(() => useCanvasKeyboard(ref))

    dispatchKey('h')
    expect(toggleSpy).toHaveBeenCalled()
  })

  it('does not handle keys when INPUT is focused', () => {
    const moveFocusSpy = vi.spyOn(useCanvasStore.getState(), 'moveFocus')
    const ref = { current: container }
    renderHook(() => useCanvasKeyboard(ref))

    const input = document.createElement('input')
    container.appendChild(input)
    input.focus()

    dispatchKey('w', input)
    expect(moveFocusSpy).not.toHaveBeenCalled()
  })

  it('does not handle keys when TEXTAREA is focused', () => {
    const moveFocusSpy = vi.spyOn(useCanvasStore.getState(), 'moveFocus')
    const ref = { current: container }
    renderHook(() => useCanvasKeyboard(ref))

    const textarea = document.createElement('textarea')
    container.appendChild(textarea)
    textarea.focus()

    dispatchKey('w', textarea)
    expect(moveFocusSpy).not.toHaveBeenCalled()
  })

  it('does not handle keys when contenteditable element is focused', () => {
    const moveFocusSpy = vi.spyOn(useCanvasStore.getState(), 'moveFocus')
    const ref = { current: container }
    renderHook(() => useCanvasKeyboard(ref))

    const editable = document.createElement('div')
    editable.setAttribute('tabindex', '0')
    container.appendChild(editable)
    editable.focus()
    // Stub isContentEditable since jsdom doesn't implement it
    Object.defineProperty(editable, 'isContentEditable', { value: true })

    dispatchKey('w', editable)
    expect(moveFocusSpy).not.toHaveBeenCalled()
  })

  it('does not handle keys when CodeMirror editor is focused', () => {
    const moveFocusSpy = vi.spyOn(useCanvasStore.getState(), 'moveFocus')
    const ref = { current: container }
    renderHook(() => useCanvasKeyboard(ref))

    const cmEditor = document.createElement('div')
    cmEditor.className = 'cm-editor'
    const cmContent = document.createElement('div')
    cmContent.className = 'cm-content'
    cmContent.setAttribute('contenteditable', 'true') // CM uses contentEditable
    cmContent.setAttribute('tabindex', '0')
    cmEditor.appendChild(cmContent)
    container.appendChild(cmEditor)
    cmContent.focus()

    dispatchKey('w', cmContent)
    expect(moveFocusSpy).not.toHaveBeenCalled()
  })

  it('cleans up event listener on unmount', () => {
    const ref = { current: container }
    const { unmount } = renderHook(() => useCanvasKeyboard(ref))

    const moveFocusSpy = vi.spyOn(useCanvasStore.getState(), 'moveFocus')
    unmount()

    dispatchKey('w')
    expect(moveFocusSpy).not.toHaveBeenCalled()
  })

  it('handles null container ref', () => {
    const ref = { current: null }
    expect(() => {
      renderHook(() => useCanvasKeyboard(ref))
    }).not.toThrow()
  })

  it('ignores unrecognized keys', () => {
    const moveFocusSpy = vi.spyOn(useCanvasStore.getState(), 'moveFocus')
    const navigateLeftSpy = vi.spyOn(useCanvasStore.getState(), 'navigateLeft')
    const navigateRightSpy = vi.spyOn(useCanvasStore.getState(), 'navigateRight')
    const toggleSpy = vi.spyOn(useCanvasStore.getState(), 'toggleHideNode')
    const ref = { current: container }
    renderHook(() => useCanvasKeyboard(ref))

    dispatchKey('x')
    dispatchKey('z')
    dispatchKey(' ')

    expect(moveFocusSpy).not.toHaveBeenCalled()
    expect(navigateLeftSpy).not.toHaveBeenCalled()
    expect(navigateRightSpy).not.toHaveBeenCalled()
    expect(toggleSpy).not.toHaveBeenCalled()
  })
})
