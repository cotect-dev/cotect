import { describe, it, expect, vi } from 'vitest'

// Mock web-tree-sitter to avoid WASM loading
vi.mock('web-tree-sitter', () => ({
  Parser: { init: vi.fn() },
  Query: vi.fn(),
  Language: { load: vi.fn() },
}))

import { resolveImportPath } from './treesitter'

describe('resolveImportPath', () => {
  it('returns null for non-relative (external) imports', () => {
    expect(resolveImportPath('react', '/src/App.tsx')).toBeNull()
    expect(resolveImportPath('zustand', '/src/store/chat.ts')).toBeNull()
    expect(resolveImportPath('@tauri-apps/api', '/src/main.ts')).toBeNull()
  })

  it('resolves same-directory relative import', () => {
    expect(resolveImportPath('./utils', '/src/lib/main.ts')).toBe('/src/lib/utils')
  })

  it('resolves parent-directory relative import', () => {
    expect(resolveImportPath('../utils', '/src/store/chat.ts')).toBe('/src/utils')
  })

  it('resolves deeply nested relative import', () => {
    expect(resolveImportPath('./components/Button', '/src/App.tsx')).toBe('/src/components/Button')
  })

  it('resolves multiple parent traversals', () => {
    expect(resolveImportPath('../../lib/utils', '/src/store/deep/nested.ts')).toBe('/src/lib/utils')
  })

  it('resolves with index path', () => {
    expect(resolveImportPath('./platform', '/src/services/main.ts')).toBe('/src/services/platform')
  })

  it('handles ./ in path correctly', () => {
    expect(resolveImportPath('./foo/./bar', '/src/app.ts')).toBe('/src/foo/bar')
  })
})
