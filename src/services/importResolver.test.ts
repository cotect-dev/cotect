import { describe, it, expect } from 'vitest'
import { resolveImport } from '@/services/importResolver'

const knownFiles = new Set([
  'src/main.ts',
  'src/utils.ts',
  'src/lib/helpers.ts',
  'src/lib/index.ts',
  'src/components/App.tsx',
  'pkg/server/main.go',
  'pkg/server/handler.go',
  'pkg/utils/strings.go',
  'src/main.py',
  'src/utils/__init__.py',
  'src/utils/helpers.py',
  'src/lib.rs',
  'src/utils.rs',
  'src/utils/mod.rs',
  'src/utils/helpers.rs',
])

describe('resolveImport', () => {
  describe('JS/TS resolution', () => {
    it('resolves relative import with extension probing', () => {
      expect(resolveImport('./utils', 'src/main.ts', knownFiles, 'typescript')).toBe('src/utils.ts')
    })

    it('resolves relative import to index file', () => {
      expect(resolveImport('./lib', 'src/main.ts', knownFiles, 'typescript')).toBe('src/lib/index.ts')
    })

    it('resolves parent directory import', () => {
      expect(resolveImport('../main', 'src/lib/helpers.ts', knownFiles, 'typescript')).toBe('src/main.ts')
    })

    it('resolves @/ alias imports to src/', () => {
      expect(resolveImport('@/utils', 'src/main.ts', knownFiles, 'typescript')).toBe('src/utils.ts')
    })

    it('resolves @/ alias import to index file', () => {
      expect(resolveImport('@/lib', 'src/main.ts', knownFiles, 'typescript')).toBe('src/lib/index.ts')
    })

    it('resolves @/ alias import with nested path', () => {
      expect(resolveImport('@/lib/helpers', 'src/main.ts', knownFiles, 'typescript')).toBe('src/lib/helpers.ts')
    })

    it('resolves @/ alias import to .tsx file', () => {
      expect(resolveImport('@/components/App', 'src/main.ts', knownFiles, 'typescript')).toBe('src/components/App.tsx')
    })

    it('returns null for bare specifiers', () => {
      expect(resolveImport('react', 'src/main.ts', knownFiles, 'typescript')).toBeNull()
    })

    it('returns null for self-imports', () => {
      expect(resolveImport('./main', 'src/main.ts', knownFiles, 'typescript')).toBeNull()
    })
  })

  describe('Python resolution', () => {
    it('resolves relative import (single dot)', () => {
      expect(resolveImport('.helpers', 'src/utils/__init__.py', knownFiles, 'python')).toBe('src/utils/helpers.py')
    })

    it('resolves double-dot relative import', () => {
      expect(resolveImport('..main', 'src/utils/helpers.py', knownFiles, 'python')).toBe('src/main.py')
    })

    it('resolves absolute import via dotted path', () => {
      expect(resolveImport('src.utils.helpers', 'src/main.py', knownFiles, 'python')).toBe('src/utils/helpers.py')
    })

    it('resolves to __init__.py for package imports', () => {
      expect(resolveImport('src.utils', 'src/main.py', knownFiles, 'python')).toBe('src/utils/__init__.py')
    })

    it('returns null for stdlib/external imports', () => {
      expect(resolveImport('os.path', 'src/main.py', knownFiles, 'python')).toBeNull()
    })
  })

  describe('Go resolution', () => {
    it('resolves project-internal import path', () => {
      const result = resolveImport('pkg/utils', 'pkg/server/main.go', knownFiles, 'go')
      expect(result).toBe('pkg/utils/strings.go')
    })

    it('returns null for stdlib imports', () => {
      expect(resolveImport('fmt', 'pkg/server/main.go', knownFiles, 'go')).toBeNull()
    })

    it('returns null for external imports with domain', () => {
      expect(resolveImport('github.com/foo/bar', 'pkg/server/main.go', knownFiles, 'go')).toBeNull()
    })
  })

  describe('Rust resolution', () => {
    it('resolves crate:: path', () => {
      expect(resolveImport('crate::utils', 'src/main.rs', knownFiles, 'rust')).toBe('src/utils.rs')
    })

    it('resolves crate:: to mod.rs', () => {
      expect(resolveImport('crate::utils::helpers', 'src/main.rs', knownFiles, 'rust')).toBe('src/utils/helpers.rs')
    })

    it('resolves mod:: declaration', () => {
      expect(resolveImport('mod::utils', 'src/lib.rs', knownFiles, 'rust')).toBe('src/utils.rs')
    })

    it('resolves super:: path', () => {
      expect(resolveImport('super::lib', 'src/utils/helpers.rs', knownFiles, 'rust')).toBe('src/lib.rs')
    })

    it('returns null for external crate imports', () => {
      expect(resolveImport('serde::Serialize', 'src/main.rs', knownFiles, 'rust')).toBeNull()
    })
  })
})
