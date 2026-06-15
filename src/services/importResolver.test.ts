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
      expect(resolveImport('./lib', 'src/main.ts', knownFiles, 'typescript')).toBe(
        'src/lib/index.ts',
      )
    })

    it('resolves parent directory import', () => {
      expect(resolveImport('../main', 'src/lib/helpers.ts', knownFiles, 'typescript')).toBe(
        'src/main.ts',
      )
    })

    it('resolves @/ alias imports to src/', () => {
      expect(resolveImport('@/utils', 'src/main.ts', knownFiles, 'typescript')).toBe('src/utils.ts')
    })

    it('resolves @/ alias import to index file', () => {
      expect(resolveImport('@/lib', 'src/main.ts', knownFiles, 'typescript')).toBe(
        'src/lib/index.ts',
      )
    })

    it('resolves @/ alias import with nested path', () => {
      expect(resolveImport('@/lib/helpers', 'src/main.ts', knownFiles, 'typescript')).toBe(
        'src/lib/helpers.ts',
      )
    })

    it('resolves @/ alias import to .tsx file', () => {
      expect(resolveImport('@/components/App', 'src/main.ts', knownFiles, 'typescript')).toBe(
        'src/components/App.tsx',
      )
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
      expect(resolveImport('.helpers', 'src/utils/__init__.py', knownFiles, 'python')).toBe(
        'src/utils/helpers.py',
      )
    })

    it('resolves double-dot relative import', () => {
      expect(resolveImport('..main', 'src/utils/helpers.py', knownFiles, 'python')).toBe(
        'src/main.py',
      )
    })

    it('resolves absolute import via dotted path', () => {
      expect(resolveImport('src.utils.helpers', 'src/main.py', knownFiles, 'python')).toBe(
        'src/utils/helpers.py',
      )
    })

    it('resolves to __init__.py for package imports', () => {
      expect(resolveImport('src.utils', 'src/main.py', knownFiles, 'python')).toBe(
        'src/utils/__init__.py',
      )
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
      expect(resolveImport('crate::utils::helpers', 'src/main.rs', knownFiles, 'rust')).toBe(
        'src/utils/helpers.rs',
      )
    })

    it('resolves mod:: declaration', () => {
      expect(resolveImport('mod::utils', 'src/lib.rs', knownFiles, 'rust')).toBe('src/utils.rs')
    })

    it('resolves super:: path', () => {
      expect(resolveImport('super::lib', 'src/utils/helpers.rs', knownFiles, 'rust')).toBe(
        'src/lib.rs',
      )
    })

    it('returns null for external crate imports', () => {
      expect(resolveImport('serde::Serialize', 'src/main.rs', knownFiles, 'rust')).toBeNull()
    })
  })

  describe('real-world layouts', () => {
    const repo = new Set([
      'internal/db/db.go',
      'pkg/util/util.go',
      'cmd/main.go',
      'src/mypkg/__init__.py',
      'src/mypkg/core.py',
      'tauri/src/main.rs',
      'tauri/src/db/mod.rs',
      'tauri/src/db/kv.rs',
      'tauri/src/git.rs',
    ])

    // The go.mod module name ('myapp') is not a directory inside the repo.
    it('resolves go imports prefixed with the module name', () => {
      expect(resolveImport('myapp/internal/db', 'cmd/main.go', repo, 'go')).toBe(
        'internal/db/db.go',
      )
    })

    it('resolves go self-imports using full domain module paths', () => {
      expect(resolveImport('github.com/user/myapp/pkg/util', 'cmd/main.go', repo, 'go')).toBe(
        'pkg/util/util.go',
      )
    })

    it('still rejects external domain imports', () => {
      expect(resolveImport('github.com/stretchr/testify', 'cmd/main.go', repo, 'go')).toBeNull()
    })

    // src-layout python repos import 'mypkg.core' while files live in src/.
    it('resolves python src-layout absolute imports', () => {
      expect(resolveImport('mypkg.core', 'src/mypkg/__init__.py', repo, 'python')).toBe(
        'src/mypkg/core.py',
      )
    })

    // A test outside src/ still imports the package by its absolute name.
    it('resolves src-layout package imports from a file outside src/', () => {
      expect(resolveImport('mypkg.core', 'tests/test_core.py', repo, 'python')).toBe(
        'src/mypkg/core.py',
      )
    })

    // The rust crate root is tauri/src, not the repo root.
    it('resolves crate:: relative to the importing file crate root', () => {
      expect(resolveImport('crate::db::kv', 'tauri/src/git.rs', repo, 'rust')).toBe(
        'tauri/src/db/kv.rs',
      )
    })

    // `use crate::db::kv::get_conn` names an item; the module file should win.
    it('falls back to the parent module when the use leaf is an item', () => {
      expect(resolveImport('crate::db::kv::get_conn', 'tauri/src/git.rs', repo, 'rust')).toBe(
        'tauri/src/db/kv.rs',
      )
    })
  })

  // The import root is a nested directory (here app/jobs/), so `from helpers
  // import X` and `from store.client import Y` are absolute imports relative to
  // that directory, not the repo root or src/.
  describe('python nested source roots', () => {
    const nested = new Set([
      'app/jobs/main.py',
      'app/jobs/helpers.py',
      'app/jobs/config.py',
      'app/jobs/store/__init__.py',
      'app/jobs/store/client.py',
      'app/jobs/pipeline/__init__.py',
      'app/jobs/pipeline/builder.py',
    ])
    const from = 'app/jobs/main.py'

    it('resolves a sibling module imported absolutely', () => {
      expect(resolveImport('helpers', from, nested, 'python')).toBe('app/jobs/helpers.py')
    })

    it('resolves a subpackage module imported absolutely', () => {
      expect(resolveImport('store.client', from, nested, 'python')).toBe('app/jobs/store/client.py')
      expect(resolveImport('pipeline.builder', from, nested, 'python')).toBe(
        'app/jobs/pipeline/builder.py',
      )
    })

    it('resolves a subpackage to its __init__.py', () => {
      expect(resolveImport('store', from, nested, 'python')).toBe('app/jobs/store/__init__.py')
    })

    it('still returns null for third-party imports from a nested file', () => {
      expect(resolveImport('requests.adapters', from, nested, 'python')).toBeNull()
    })

    it('prefers the source root closest to the importing file', () => {
      const withShadow = new Set([...nested, 'app/helpers.py', 'helpers.py'])
      expect(resolveImport('helpers', from, withShadow, 'python')).toBe('app/jobs/helpers.py')
    })
  })

  // The source root can be a sibling tree the ancestor walk cannot reach: a
  // src/ layout imported from tests/, or a monorepo lib dir with any name.
  // Dotted imports fall back to matching the module path as a suffix anywhere.
  describe('python sibling source trees', () => {
    const monorepo = new Set([
      'services/api/main.py',
      'services/api/routes.py',
      'libs/common/__init__.py',
      'libs/common/models.py',
      'libs/common/db/__init__.py',
      'libs/common/db/session.py',
    ])
    const from = 'services/api/main.py'

    it('resolves a dotted import into a sibling lib tree of any name', () => {
      expect(resolveImport('common.models', from, monorepo, 'python')).toBe('libs/common/models.py')
      expect(resolveImport('common.db.session', from, monorepo, 'python')).toBe(
        'libs/common/db/session.py',
      )
    })

    it('resolves a dotted import to a sibling package __init__.py', () => {
      expect(resolveImport('common.db', from, monorepo, 'python')).toBe(
        'libs/common/db/__init__.py',
      )
    })

    it('prefers the sibling tree closest to the importing file', () => {
      // Neither root is an ancestor of services/api, so both go through the
      // suffix fallback; services/web shares the services/ prefix and wins.
      const multi = new Set([
        'services/api/main.py',
        'services/web/shared/models.py',
        'vendor/shared/models.py',
      ])
      expect(resolveImport('shared.models', from, multi, 'python')).toBe(
        'services/web/shared/models.py',
      )
    })

    it('does not invent an edge for a bare import that shadows a stray file name', () => {
      // `import yaml` is almost certainly the third-party package even though an
      // unrelated yaml.py exists elsewhere; single-segment imports never fall
      // back to a repo-wide suffix match.
      const withStray = new Set(['services/api/main.py', 'vendor/yaml.py'])
      expect(resolveImport('yaml', from, withStray, 'python')).toBeNull()
    })

    it('returns null when a dotted import matches nothing', () => {
      expect(resolveImport('numpy.linalg', from, monorepo, 'python')).toBeNull()
    })
  })
})
