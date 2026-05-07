# Import Graph View Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken grid-based graph view (view 2) with a force-directed dependency graph that surfaces hub files, supports JS/TS/Python/Go/Rust, and lets users click-to-navigate into the files view.

**Architecture:** Extend the tree-sitter service with per-language import extractors. Move graph scan/state into a dedicated zustand store (`graph.ts`). Rewrite the `Graph/index.tsx` component to use d3-force for layout, hub-based filtering, language-colored nodes, and hover-to-highlight edges. Clicking a node switches to view 1 via `focusFileByPath`.

**Tech Stack:** React, ReactFlow (`@xyflow/react`), d3-force, web-tree-sitter (WASM), zustand, Tailwind CSS

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/services/treesitter-queries.ts` | Per-language import extraction + language config registry |
| Modify | `src/services/treesitter.ts` | Load Python/Go/Rust WASM grammars, dispatch to correct extractor |
| Create | `src/services/treesitter-queries.test.ts` | Tests for language config + import extraction |
| Create | `src/services/importResolver.ts` | Language-aware import → repo-relative-path resolution |
| Create | `src/services/importResolver.test.ts` | Tests for resolution logic |
| Create | `src/store/graph.ts` | Graph scan state, hub scoring, visible subset |
| Create | `src/store/graph.test.ts` | Tests for hub filtering and state transitions |
| Rewrite | `src/components/Graph/index.tsx` | Force-directed ReactFlow graph component |
| Modify | `src/store/index.ts` | Export `useGraphStore` |
| Modify | `package.json` | Add `d3-force` + `@types/d3-force` |
| Add | `public/tree-sitter-python.wasm` | Python grammar |
| Add | `public/tree-sitter-go.wasm` | Go grammar |
| Add | `public/tree-sitter-rust.wasm` | Rust grammar |

---

### Task 1: Add d3-force dependency and WASM grammars

**Files:**
- Modify: `package.json`
- Add: `public/tree-sitter-python.wasm`, `public/tree-sitter-go.wasm`, `public/tree-sitter-rust.wasm`

- [ ] **Step 1: Install d3-force with types**

```bash
cd /Users/grzegorzraczek/dev/priv/cotect && yarn add d3-force && yarn add -D @types/d3-force
```

Expected: packages added to `package.json` dependencies/devDependencies.

- [ ] **Step 2: Download tree-sitter WASM grammars**

Download pre-built WASM grammars from npm packages into `public/`:

```bash
cd /Users/grzegorzraczek/dev/priv/cotect

# Python — the npm package ships a .wasm in its root
PYTHON_WASM=$(find node_modules/web-tree-sitter -path '*/tree-sitter.wasm' -print -quit | head -1)
# We need the actual grammar WASMs. These come from separate packages.
# Install temporarily to extract the .wasm files:
yarn add -D tree-sitter-python tree-sitter-go tree-sitter-rust

# The WASM files need to be built from the grammar packages.
# Instead, download pre-built WASMs from the tree-sitter releases:
curl -L -o public/tree-sitter-python.wasm "https://github.com/nicolo-ribaudo/tree-sitter-wasm-builds/releases/download/web-tree-sitter%400.26.7/tree-sitter-python.wasm"
curl -L -o public/tree-sitter-go.wasm "https://github.com/nicolo-ribaudo/tree-sitter-wasm-builds/releases/download/web-tree-sitter%400.26.7/tree-sitter-go.wasm"
curl -L -o public/tree-sitter-rust.wasm "https://github.com/nicolo-ribaudo/tree-sitter-wasm-builds/releases/download/web-tree-sitter%400.26.7/tree-sitter-rust.wasm"
```

If the above URL doesn't work, build them locally:

```bash
cd /Users/grzegorzraczek/dev/priv/cotect
npx tree-sitter build --wasm node_modules/tree-sitter-python && mv tree-sitter-python.wasm public/
npx tree-sitter build --wasm node_modules/tree-sitter-go && mv tree-sitter-go.wasm public/
npx tree-sitter build --wasm node_modules/tree-sitter-rust && mv tree-sitter-rust.wasm public/
```

Expected: three `.wasm` files in `public/` alongside the existing `tree-sitter-javascript.wasm` and `tree-sitter-typescript.wasm`.

- [ ] **Step 3: Verify WASM files exist**

```bash
ls -la /Users/grzegorzraczek/dev/priv/cotect/public/tree-sitter-*.wasm
```

Expected: 5 `.wasm` files (javascript, typescript, python, go, rust).

- [ ] **Step 4: Commit**

```bash
git add package.json yarn.lock public/tree-sitter-python.wasm public/tree-sitter-go.wasm public/tree-sitter-rust.wasm
git commit -m "chore: add d3-force dependency and tree-sitter WASM grammars for Python, Go, Rust"
```

---

### Task 2: Extend language config registry in treesitter-queries.ts

**Files:**
- Modify: `src/services/treesitter-queries.ts`
- Modify: `src/services/treesitter-queries.test.ts`

- [ ] **Step 1: Write failing tests for new language configs**

Replace the full contents of `src/services/treesitter-queries.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { getConfigForFile, type LanguageId } from '@/services/treesitter-queries'

describe('getConfigForFile', () => {
  it('returns typescript config for .ts files', () => {
    const config = getConfigForFile('src/main.ts')
    expect(config).not.toBeNull()
    expect(config!.id).toBe('typescript' satisfies LanguageId)
    expect(config!.extensions).toContain('.ts')
  })

  it('returns typescript config for .tsx files', () => {
    const config = getConfigForFile('component.tsx')
    expect(config).not.toBeNull()
    expect(config!.extensions).toContain('.tsx')
  })

  it('returns javascript config for .js files', () => {
    const config = getConfigForFile('index.js')
    expect(config).not.toBeNull()
    expect(config!.id).toBe('javascript' satisfies LanguageId)
  })

  it('returns javascript config for .jsx files', () => {
    const config = getConfigForFile('App.jsx')
    expect(config).not.toBeNull()
    expect(config!.extensions).toContain('.jsx')
  })

  it('returns python config for .py files', () => {
    const config = getConfigForFile('main.py')
    expect(config).not.toBeNull()
    expect(config!.id).toBe('python' satisfies LanguageId)
    expect(config!.extensions).toContain('.py')
  })

  it('returns go config for .go files', () => {
    const config = getConfigForFile('main.go')
    expect(config).not.toBeNull()
    expect(config!.id).toBe('go' satisfies LanguageId)
    expect(config!.extensions).toContain('.go')
  })

  it('returns rust config for .rs files', () => {
    const config = getConfigForFile('lib.rs')
    expect(config).not.toBeNull()
    expect(config!.id).toBe('rust' satisfies LanguageId)
    expect(config!.extensions).toContain('.rs')
  })

  it('returns null for unsupported extensions', () => {
    expect(getConfigForFile('style.css')).toBeNull()
    expect(getConfigForFile('data.json')).toBeNull()
    expect(getConfigForFile('readme.md')).toBeNull()
  })

  it('handles files with multiple dots', () => {
    const config = getConfigForFile('my.component.test.tsx')
    expect(config).not.toBeNull()
    expect(config!.extensions).toContain('.tsx')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/grzegorzraczek/dev/priv/cotect && npx vitest run src/services/treesitter-queries.test.ts
```

Expected: FAIL — `LanguageId` is not exported, `config.id` does not exist, python/go/rust tests fail.

- [ ] **Step 3: Update treesitter-queries.ts with new language configs**

Replace the full contents of `src/services/treesitter-queries.ts`:

```typescript
export type LanguageId = 'typescript' | 'javascript' | 'python' | 'go' | 'rust'

export interface LanguageConfig {
  id: LanguageId
  extensions: string[]
}

const typescriptConfig: LanguageConfig = {
  id: 'typescript',
  extensions: ['.ts', '.tsx'],
}

const javascriptConfig: LanguageConfig = {
  id: 'javascript',
  extensions: ['.js', '.jsx', '.mjs', '.cjs'],
}

const pythonConfig: LanguageConfig = {
  id: 'python',
  extensions: ['.py'],
}

const goConfig: LanguageConfig = {
  id: 'go',
  extensions: ['.go'],
}

const rustConfig: LanguageConfig = {
  id: 'rust',
  extensions: ['.rs'],
}

export const LANGUAGE_CONFIGS: LanguageConfig[] = [
  typescriptConfig,
  javascriptConfig,
  pythonConfig,
  goConfig,
  rustConfig,
]

/** Set of all file extensions we can parse imports from. */
export const PARSEABLE_EXTENSIONS: Set<string> = new Set(
  LANGUAGE_CONFIGS.flatMap((c) => c.extensions),
)

export function getConfigForFile(filename: string): LanguageConfig | null {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return LANGUAGE_CONFIGS.find((c) => c.extensions.includes(ext)) ?? null
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/grzegorzraczek/dev/priv/cotect && npx vitest run src/services/treesitter-queries.test.ts
```

Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/treesitter-queries.ts src/services/treesitter-queries.test.ts
git commit -m "feat: extend language config registry with Python, Go, Rust"
```

---

### Task 3: Add multi-language import extraction in treesitter.ts

**Files:**
- Modify: `src/services/treesitter.ts`

The existing `collectImportSpecifiers` and `readStringLiteral` functions handle JS/TS. We need per-language extractors and updated grammar loading.

- [ ] **Step 1: Replace treesitter.ts with multi-language support**

Replace the full contents of `src/services/treesitter.ts`:

```typescript
/**
 * Lazy web-tree-sitter loader and multi-language import extractor used by the
 * Graph view. Parser/Language WASMs are fetched once and cached for the
 * lifetime of the page.
 *
 * Supported languages: JS/TS, Python, Go, Rust.
 * Each gets a dedicated AST-walker that returns raw import specifier strings.
 */
import { Parser, Language } from 'web-tree-sitter'
import { getConfigForFile, type LanguageId } from '@/services/treesitter-queries'

type TSNode = import('web-tree-sitter').Node

const WASM_BASE = '/'

let initPromise: Promise<void> | null = null
const languagePromises = new Map<string, Promise<Language>>()
const parserPool: Parser[] = []

async function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init({
      locateFile: (name: string) => `${WASM_BASE}${name}`,
    })
  }
  await initPromise
}

const WASM_MAP: Record<LanguageId, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm',
  rust: 'tree-sitter-rust.wasm',
}

async function loadLanguageForFile(filename: string): Promise<{ language: Language; id: LanguageId } | null> {
  const config = getConfigForFile(filename)
  if (!config) return null

  const wasmFile = WASM_MAP[config.id]
  if (!languagePromises.has(wasmFile)) {
    await ensureInit()
    languagePromises.set(wasmFile, Language.load(`${WASM_BASE}${wasmFile}`))
  }
  const language = await languagePromises.get(wasmFile)!
  return { language, id: config.id }
}

function acquireParser(): Parser {
  return parserPool.pop() ?? new Parser()
}

function releaseParser(parser: Parser): void {
  parserPool.push(parser)
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function readStringLiteral(node: TSNode | null): string | null {
  if (!node) return null
  if (node.type !== 'string' && node.type !== 'interpreted_string_literal' && node.type !== 'string_literal') return null
  const raw = node.text
  if (raw.length < 2) return null
  const quote = raw[0]
  if (quote !== '"' && quote !== "'" && quote !== '`') return null
  return raw.slice(1, -1)
}

// ---------------------------------------------------------------------------
// JS/TS extractor
// ---------------------------------------------------------------------------

function collectJsTsImports(rootNode: TSNode): string[] {
  const specifiers: string[] = []
  const stack: TSNode[] = [rootNode]
  while (stack.length > 0) {
    const node = stack.pop()!
    const type = node.type

    if (type === 'import_statement' || type === 'export_statement') {
      const src = node.childForFieldName('source')
      const literal = readStringLiteral(src)
      if (literal !== null) specifiers.push(literal)
    } else if (type === 'call_expression') {
      const fn = node.childForFieldName('function')
      const args = node.childForFieldName('arguments')
      if (fn && args && (fn.type === 'import' || fn.text === 'require')) {
        const first = args.namedChildren[0]
        const literal = readStringLiteral(first ?? null)
        if (literal !== null) specifiers.push(literal)
      }
    }

    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) stack.push(child)
    }
  }
  return specifiers
}

// ---------------------------------------------------------------------------
// Python extractor
// ---------------------------------------------------------------------------

function collectPythonImports(rootNode: TSNode): string[] {
  const specifiers: string[] = []
  const stack: TSNode[] = [rootNode]
  while (stack.length > 0) {
    const node = stack.pop()!
    const type = node.type

    // `import foo.bar` → module_name is "foo.bar"
    if (type === 'import_statement') {
      const name = node.childForFieldName('name')
      if (name) specifiers.push(name.text)
    }
    // `from foo.bar import baz` → module_name is "foo.bar"
    // `from . import baz` → module_name is "."
    // `from ..utils import x` → module_name is "..utils"
    if (type === 'import_from_statement') {
      const moduleName = node.childForFieldName('module_name')
      if (moduleName) {
        specifiers.push(moduleName.text)
      } else {
        // `from . import x` — tree-sitter may put the relative prefix differently
        // Walk children to find relative_import or dotted_name
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child && (child.type === 'relative_import' || child.type === 'dotted_name')) {
            specifiers.push(child.text)
            break
          }
        }
      }
    }

    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) stack.push(child)
    }
  }
  return specifiers
}

// ---------------------------------------------------------------------------
// Go extractor
// ---------------------------------------------------------------------------

function collectGoImports(rootNode: TSNode): string[] {
  const specifiers: string[] = []
  const stack: TSNode[] = [rootNode]
  while (stack.length > 0) {
    const node = stack.pop()!

    if (node.type === 'import_spec') {
      const path = node.childForFieldName('path')
      const literal = readStringLiteral(path)
      if (literal !== null) specifiers.push(literal)
    }

    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) stack.push(child)
    }
  }
  return specifiers
}

// ---------------------------------------------------------------------------
// Rust extractor
// ---------------------------------------------------------------------------

function collectRustImports(rootNode: TSNode): string[] {
  const specifiers: string[] = []
  const stack: TSNode[] = [rootNode]
  while (stack.length > 0) {
    const node = stack.pop()!

    // `use crate::foo::bar;` or `use super::baz;`
    if (node.type === 'use_declaration') {
      // The argument child holds the path: `crate::foo::bar` or `super::baz`
      const arg = node.namedChildren.find((c) =>
        c.type === 'scoped_identifier' ||
        c.type === 'use_as_clause' ||
        c.type === 'scoped_use_list' ||
        c.type === 'identifier'
      )
      if (arg) specifiers.push(arg.text)
    }

    // `mod foo;` — declares a submodule (file dependency)
    if (node.type === 'mod_item') {
      const name = node.childForFieldName('name')
      if (name) specifiers.push(`mod::${name.text}`)
    }

    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) stack.push(child)
    }
  }
  return specifiers
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const EXTRACTORS: Record<LanguageId, (root: TSNode) => string[]> = {
  typescript: collectJsTsImports,
  javascript: collectJsTsImports,
  python: collectPythonImports,
  go: collectGoImports,
  rust: collectRustImports,
}

/**
 * Parse `source` as the language implied by `filename`'s extension and return
 * the literal import specifiers found inside. Returns `[]` for unsupported
 * languages or parse failures.
 */
export async function parseImports(filename: string, source: string): Promise<string[]> {
  const loaded = await loadLanguageForFile(filename)
  if (!loaded) return []

  const parser = acquireParser()
  try {
    parser.setLanguage(loaded.language)
    const tree = parser.parse(source)
    if (!tree) return []
    try {
      return EXTRACTORS[loaded.id](tree.rootNode)
    } finally {
      tree.delete()
    }
  } catch {
    return []
  } finally {
    releaseParser(parser)
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/grzegorzraczek/dev/priv/cotect && npx tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run existing tests to ensure nothing broke**

```bash
cd /Users/grzegorzraczek/dev/priv/cotect && npx vitest run
```

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/services/treesitter.ts
git commit -m "feat: add tree-sitter import extraction for Python, Go, Rust"
```

---

### Task 4: Create language-aware import resolver

**Files:**
- Create: `src/services/importResolver.ts`
- Create: `src/services/importResolver.test.ts`

This extracts the `resolveImport` logic from `Graph/index.tsx`, makes it language-aware, and adds resolution for Python, Go, and Rust.

- [ ] **Step 1: Write failing tests**

Create `src/services/importResolver.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/grzegorzraczek/dev/priv/cotect && npx vitest run src/services/importResolver.test.ts
```

Expected: FAIL — module `@/services/importResolver` does not exist.

- [ ] **Step 3: Implement importResolver.ts**

Create `src/services/importResolver.ts`:

```typescript
import type { LanguageId } from '@/services/treesitter-queries'

function dirname(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(0, slash) : ''
}

function normalizePath(segments: string[]): string {
  const stack: string[] = []
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (stack.length > 0) stack.pop()
      continue
    }
    stack.push(seg)
  }
  return stack.join('/')
}

// ---------------------------------------------------------------------------
// JS/TS
// ---------------------------------------------------------------------------

const JS_RESOLVE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

function resolveJsTs(
  specifier: string,
  fromRel: string,
  knownFiles: Set<string>,
): string | null {
  if (!specifier.startsWith('.')) return null

  const baseDir = dirname(fromRel)
  const segments = (baseDir ? baseDir.split('/') : []).concat(specifier.split('/'))
  const resolved = normalizePath(segments)

  for (const ext of JS_RESOLVE_EXTENSIONS) {
    const candidate = resolved + ext
    if (knownFiles.has(candidate) && candidate !== fromRel) return candidate
  }
  for (const ext of JS_RESOLVE_EXTENSIONS) {
    if (ext === '') continue
    const candidate = `${resolved}/index${ext}`
    if (knownFiles.has(candidate) && candidate !== fromRel) return candidate
  }
  return null
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

function resolvePython(
  specifier: string,
  fromRel: string,
  knownFiles: Set<string>,
): string | null {
  // Count leading dots for relative imports
  let dots = 0
  while (dots < specifier.length && specifier[dots] === '.') dots++

  if (dots > 0) {
    // Relative import
    const rest = specifier.slice(dots)
    const fromDir = dirname(fromRel)
    const fromSegments = fromDir ? fromDir.split('/') : []

    // Each dot beyond the first goes up one directory
    // from . import x → same package
    // from .. import x → parent package
    const parentCount = Math.max(0, dots - 1)
    const base = fromSegments.slice(0, fromSegments.length - parentCount)

    const moduleParts = rest ? rest.split('.') : []
    const searchPath = [...base, ...moduleParts].join('/')

    // Try as direct file
    const pyCandidate = searchPath + '.py'
    if (knownFiles.has(pyCandidate) && pyCandidate !== fromRel) return pyCandidate

    // Try as package
    const initCandidate = searchPath + '/__init__.py'
    if (knownFiles.has(initCandidate) && initCandidate !== fromRel) return initCandidate

    return null
  }

  // Absolute import — convert dots to slashes
  const asPath = specifier.replace(/\./g, '/')

  const pyCandidate = asPath + '.py'
  if (knownFiles.has(pyCandidate) && pyCandidate !== fromRel) return pyCandidate

  const initCandidate = asPath + '/__init__.py'
  if (knownFiles.has(initCandidate) && initCandidate !== fromRel) return initCandidate

  return null
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

function resolveGo(
  specifier: string,
  _fromRel: string,
  knownFiles: Set<string>,
): string | null {
  // External imports contain a domain (has a dot in the first segment)
  // or are stdlib (single word like "fmt", "net/http")
  const firstSlash = specifier.indexOf('/')
  const firstSegment = firstSlash >= 0 ? specifier.slice(0, firstSlash) : specifier
  if (firstSegment.includes('.')) return null // github.com/foo/bar
  if (firstSlash < 0) return null // stdlib single-word like "fmt"

  // Check if any known file lives under this package directory
  const prefix = specifier + '/'
  for (const f of knownFiles) {
    if (f.startsWith(prefix) && f.endsWith('.go')) return f
  }

  return null
}

// ---------------------------------------------------------------------------
// Rust
// ---------------------------------------------------------------------------

function resolveRust(
  specifier: string,
  fromRel: string,
  knownFiles: Set<string>,
): string | null {
  let pathParts: string[]

  if (specifier.startsWith('mod::')) {
    // `mod foo;` declaration — looks for foo.rs or foo/mod.rs as sibling
    const modName = specifier.slice(5)
    const fromDir = dirname(fromRel)
    const base = fromDir ? fromDir + '/' : ''

    const rsCandidate = base + modName + '.rs'
    if (knownFiles.has(rsCandidate) && rsCandidate !== fromRel) return rsCandidate

    const modRsCandidate = base + modName + '/mod.rs'
    if (knownFiles.has(modRsCandidate)) return modRsCandidate

    return null
  }

  if (specifier.startsWith('crate::')) {
    // crate:: paths resolve from the project's src/ root
    const rest = specifier.slice(7) // strip "crate::"
    pathParts = rest.split('::')
  } else if (specifier.startsWith('super::')) {
    const rest = specifier.slice(7) // strip "super::"
    const fromDir = dirname(fromRel)
    const parentDir = dirname(fromDir)
    const parentSegments = parentDir ? parentDir.split('/') : []
    pathParts = [...parentSegments, ...rest.split('::')]
  } else if (specifier.startsWith('self::')) {
    const rest = specifier.slice(6)
    const fromDir = dirname(fromRel)
    const segments = fromDir ? fromDir.split('/') : []
    pathParts = [...segments, ...rest.split('::')]
  } else {
    // External crate — no resolution
    return null
  }

  // For crate:: paths, prepend "src" as the conventional crate root
  const searchBase = specifier.startsWith('crate::') ? ['src', ...pathParts.slice(0)] : pathParts

  // Actually, crate:: already stripped "crate::", pathParts is the rest.
  // We need to figure out where the crate root is. Convention: src/
  const basePath = specifier.startsWith('crate::')
    ? 'src/' + pathParts.join('/')
    : pathParts.join('/')

  // Try as direct file
  const rsCandidate = basePath + '.rs'
  if (knownFiles.has(rsCandidate) && rsCandidate !== fromRel) return rsCandidate

  // Try as module directory
  const modRsCandidate = basePath + '/mod.rs'
  if (knownFiles.has(modRsCandidate)) return modRsCandidate

  return null
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const RESOLVERS: Record<LanguageId, (spec: string, from: string, known: Set<string>) => string | null> = {
  typescript: resolveJsTs,
  javascript: resolveJsTs,
  python: resolvePython,
  go: resolveGo,
  rust: resolveRust,
}

/**
 * Resolve an import specifier to a repo-relative file path.
 * Returns null for external/unresolvable imports and self-imports.
 */
export function resolveImport(
  specifier: string,
  fromRel: string,
  knownFiles: Set<string>,
  language: LanguageId,
): string | null {
  return RESOLVERS[language](specifier, fromRel, knownFiles)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/grzegorzraczek/dev/priv/cotect && npx vitest run src/services/importResolver.test.ts
```

Expected: all tests PASS. If any fail, adjust the resolver logic to match the test expectations — the tests define the contract.

- [ ] **Step 5: Run full test suite**

```bash
cd /Users/grzegorzraczek/dev/priv/cotect && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/importResolver.ts src/services/importResolver.test.ts
git commit -m "feat: add language-aware import resolver for JS/TS, Python, Go, Rust"
```

---

### Task 5: Create the graph zustand store

**Files:**
- Create: `src/store/graph.ts`
- Create: `src/store/graph.test.ts`
- Modify: `src/store/index.ts`

- [ ] **Step 1: Write failing tests**

Create `src/store/graph.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { computeVisibleNodeIds, scoreNodes, DEFAULT_HUB_COUNT } from '@/store/graph'
import type { GraphFileNode, GraphFileEdge } from '@/store/graph'

function makeNode(id: string, inDeg: number, outDeg: number): GraphFileNode {
  return {
    id,
    label: id.split('/').pop()!,
    folder: id.slice(0, id.lastIndexOf('/')),
    language: 'typescript',
    inDegree: inDeg,
    outDegree: outDeg,
    score: inDeg + outDeg,
  }
}

describe('scoreNodes', () => {
  it('computes inDegree, outDegree, and score from edges', () => {
    const nodes: GraphFileNode[] = [
      makeNode('a.ts', 0, 0),
      makeNode('b.ts', 0, 0),
      makeNode('c.ts', 0, 0),
    ]
    const edges: GraphFileEdge[] = [
      { source: 'a.ts', target: 'b.ts' },
      { source: 'a.ts', target: 'c.ts' },
      { source: 'c.ts', target: 'b.ts' },
    ]
    const scored = scoreNodes(nodes, edges)

    const a = scored.find((n) => n.id === 'a.ts')!
    expect(a.outDegree).toBe(2)
    expect(a.inDegree).toBe(0)
    expect(a.score).toBe(2)

    const b = scored.find((n) => n.id === 'b.ts')!
    expect(b.inDegree).toBe(2)
    expect(b.outDegree).toBe(0)
    expect(b.score).toBe(2)

    const c = scored.find((n) => n.id === 'c.ts')!
    expect(c.inDegree).toBe(1)
    expect(c.outDegree).toBe(1)
    expect(c.score).toBe(2)
  })
})

describe('computeVisibleNodeIds', () => {
  it('returns all nodes when count <= DEFAULT_HUB_COUNT', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => makeNode(`f${i}.ts`, i, 0))
    const result = computeVisibleNodeIds(nodes, false)
    expect(result.size).toBe(10)
  })

  it('returns top DEFAULT_HUB_COUNT nodes by score when showAll is false', () => {
    const nodes = Array.from({ length: 50 }, (_, i) => makeNode(`f${i}.ts`, i, 0))
    // Score = inDegree + outDegree = i + 0 = i
    const scored = nodes.map((n) => ({ ...n, score: n.inDegree + n.outDegree }))
    const result = computeVisibleNodeIds(scored, false)
    expect(result.size).toBe(DEFAULT_HUB_COUNT)
    // Top scored nodes should be in the set (highest inDegree)
    expect(result.has('f49.ts')).toBe(true)
    expect(result.has('f48.ts')).toBe(true)
  })

  it('returns all nodes when showAll is true', () => {
    const nodes = Array.from({ length: 50 }, (_, i) => makeNode(`f${i}.ts`, i, 0))
    const result = computeVisibleNodeIds(nodes, true)
    expect(result.size).toBe(50)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/grzegorzraczek/dev/priv/cotect && npx vitest run src/store/graph.test.ts
```

Expected: FAIL — module `@/store/graph` does not exist.

- [ ] **Step 3: Implement graph.ts**

Create `src/store/graph.ts`:

```typescript
import { create } from 'zustand'
import { createStoreWithHMR } from '@/lib/hmr'
import { getPlatform } from '@/services/platform'
import { HIDDEN_DIRECTORIES } from '@/lib/constants'
import { toRepoRelative } from '@/lib/repoPath'
import { parseImports } from '@/services/treesitter'
import { resolveImport } from '@/services/importResolver'
import { PARSEABLE_EXTENSIONS, getConfigForFile, type LanguageId } from '@/services/treesitter-queries'

export const DEFAULT_HUB_COUNT = 30
const MAX_FILES = 500

export interface GraphFileNode {
  id: string
  label: string
  folder: string
  language: LanguageId
  inDegree: number
  outDegree: number
  score: number
}

export interface GraphFileEdge {
  source: string
  target: string
}

export type GraphScanState = 'idle' | 'scanning' | 'ready' | 'error'

interface GraphState {
  scanState: GraphScanState
  scannedCount: number
  errorMessage: string | null
  allNodes: GraphFileNode[]
  allEdges: GraphFileEdge[]
  showAll: boolean
  truncated: boolean

  setShowAll: (show: boolean) => void
  scan: (rootPath: string) => Promise<void>
}

/** Compute inDegree, outDegree, score for every node based on edges. */
export function scoreNodes(nodes: GraphFileNode[], edges: GraphFileEdge[]): GraphFileNode[] {
  const inDeg = new Map<string, number>()
  const outDeg = new Map<string, number>()
  for (const e of edges) {
    outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1)
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1)
  }
  return nodes.map((n) => {
    const ind = inDeg.get(n.id) ?? 0
    const outd = outDeg.get(n.id) ?? 0
    return { ...n, inDegree: ind, outDegree: outd, score: ind + outd }
  })
}

/** Pick which node IDs to render: top hubs or all. */
export function computeVisibleNodeIds(nodes: GraphFileNode[], showAll: boolean): Set<string> {
  if (showAll || nodes.length <= DEFAULT_HUB_COUNT) {
    return new Set(nodes.map((n) => n.id))
  }
  const sorted = [...nodes].sort((a, b) => b.score - a.score)
  return new Set(sorted.slice(0, DEFAULT_HUB_COUNT).map((n) => n.id))
}

function getExtension(path: string): string {
  const slash = path.lastIndexOf('/')
  const name = slash >= 0 ? path.slice(slash + 1) : path
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function getFilename(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(slash + 1) : path
}

function getDirname(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(0, slash) : ''
}

async function collectParseableFiles(
  rootPath: string,
  budget: { remaining: number },
  onProgress: (count: number) => void,
): Promise<string[]> {
  const platform = getPlatform()
  const found: string[] = []
  const queue: string[] = [rootPath]

  while (queue.length > 0 && budget.remaining > 0) {
    const dir = queue.shift()!
    let entries
    try {
      entries = await platform.fs.readDirectory(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory) {
        if (HIDDEN_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue
        queue.push(entry.path)
      } else {
        const ext = getExtension(entry.name)
        if (!PARSEABLE_EXTENSIONS.has(ext)) continue
        if (budget.remaining <= 0) break
        budget.remaining--
        found.push(entry.path)
        if (found.length % 25 === 0) onProgress(found.length)
      }
    }
  }
  return found
}

export const useGraphStore = createStoreWithHMR(import.meta.hot, 'graph', () => create<GraphState>((set, get) => ({
  scanState: 'idle',
  scannedCount: 0,
  errorMessage: null,
  allNodes: [],
  allEdges: [],
  showAll: false,
  truncated: false,

  setShowAll: (show) => set({ showAll: show }),

  scan: async (rootPath: string) => {
    set({ scanState: 'scanning', scannedCount: 0, errorMessage: null })

    try {
      const budget = { remaining: MAX_FILES }
      const absFiles = await collectParseableFiles(rootPath, budget, (count) => {
        set({ scannedCount: count })
      })
      const truncated = absFiles.length >= MAX_FILES
      const relFiles = absFiles.map((p) => toRepoRelative(p, rootPath))
      const knownFiles = new Set(relFiles)

      const platform = getPlatform()
      const importsByFile = new Map<string, string[]>()
      await Promise.all(
        absFiles.map(async (abs, i) => {
          const rel = relFiles[i]
          try {
            const source = await platform.fs.readFile(abs)
            const specifiers = await parseImports(rel, source)
            importsByFile.set(rel, specifiers)
          } catch {
            importsByFile.set(rel, [])
          }
        }),
      )

      // Build nodes
      const rawNodes: GraphFileNode[] = relFiles.map((rel) => {
        const config = getConfigForFile(rel)
        return {
          id: rel,
          label: getFilename(rel),
          folder: getDirname(rel),
          language: config?.id ?? 'typescript',
          inDegree: 0,
          outDegree: 0,
          score: 0,
        }
      })

      // Build edges
      const edges: GraphFileEdge[] = []
      const seen = new Set<string>()
      for (const [from, specifiers] of importsByFile) {
        const config = getConfigForFile(from)
        if (!config) continue
        for (const spec of specifiers) {
          const target = resolveImport(spec, from, knownFiles, config.id)
          if (!target || target === from) continue
          const key = `${from}->${target}`
          if (seen.has(key)) continue
          seen.add(key)
          edges.push({ source: from, target })
        }
      }

      const scoredNodes = scoreNodes(rawNodes, edges)

      set({
        scanState: 'ready',
        allNodes: scoredNodes,
        allEdges: edges,
        truncated,
      })
    } catch (err) {
      set({
        scanState: 'error',
        errorMessage: (err as Error).message ?? 'unknown error',
      })
    }
  },
})))
```

- [ ] **Step 4: Export from store index**

Add to `src/store/index.ts`:

```typescript
export { useGraphStore } from './graph'
export type { GraphFileNode, GraphFileEdge, GraphScanState } from './graph'
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/grzegorzraczek/dev/priv/cotect && npx vitest run src/store/graph.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 6: Run full test suite**

```bash
cd /Users/grzegorzraczek/dev/priv/cotect && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/store/graph.ts src/store/graph.test.ts src/store/index.ts
git commit -m "feat: add graph zustand store with hub scoring and scan logic"
```

---

### Task 6: Rewrite Graph component with force-directed layout

**Files:**
- Rewrite: `src/components/Graph/index.tsx`

- [ ] **Step 1: Rewrite Graph/index.tsx**

Replace the full contents of `src/components/Graph/index.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force'
import { useGraphStore, useBrowserStore, useViewStore, useCanvasStore } from '@/store'
import { computeVisibleNodeIds, DEFAULT_HUB_COUNT, type GraphFileNode, type GraphFileEdge } from '@/store/graph'

const proOptions = { hideAttribution: true }

// ---------------------------------------------------------------------------
// Language → color mapping
// ---------------------------------------------------------------------------

const LANGUAGE_COLORS: Record<string, string> = {
  typescript: '#3b82f6', // blue
  javascript: '#3b82f6',
  python: '#22c55e',     // green
  go: '#f97316',         // orange
  rust: '#ef4444',       // red
}

const LANGUAGE_SHORT: Record<string, string> = {
  typescript: 'TS',
  javascript: 'JS',
  python: 'Py',
  go: 'Go',
  rust: 'Rs',
}

// ---------------------------------------------------------------------------
// Force layout
// ---------------------------------------------------------------------------

interface SimNode extends SimulationNodeDatum {
  id: string
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  source: string | SimNode
  target: string | SimNode
}

function computeLayout(
  nodes: GraphFileNode[],
  edges: GraphFileEdge[],
): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) return new Map()

  const simNodes: SimNode[] = nodes.map((n) => ({ id: n.id }))
  const nodeById = new Map(simNodes.map((n) => [n.id, n]))

  const simLinks: SimLink[] = edges
    .filter((e) => nodeById.has(e.source) && nodeById.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }))

  const sim = forceSimulation<SimNode>(simNodes)
    .force('link', forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(120))
    .force('charge', forceManyBody<SimNode>().strength(-200))
    .force('center', forceCenter(0, 0))
    .force('collide', forceCollide<SimNode>(60))
    .stop()

  // Run ticks synchronously
  const ticks = Math.min(300, Math.max(100, nodes.length * 2))
  for (let i = 0; i < ticks; i++) sim.tick()

  const positions = new Map<string, { x: number; y: number }>()
  for (const n of simNodes) {
    positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 })
  }
  return positions
}

// ---------------------------------------------------------------------------
// Convert graph data → ReactFlow nodes/edges
// ---------------------------------------------------------------------------

function toReactFlowData(
  allNodes: GraphFileNode[],
  allEdges: GraphFileEdge[],
  visibleIds: Set<string>,
  hoveredNodeId: string | null,
): { nodes: Node[]; edges: Edge[]; positions: Map<string, { x: number; y: number }> } {
  const visibleNodes = allNodes.filter((n) => visibleIds.has(n.id))
  const visibleEdges = allEdges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))

  const positions = computeLayout(visibleNodes, visibleEdges)

  // Determine top 10% threshold for hub sizing
  const scores = visibleNodes.map((n) => n.score).sort((a, b) => b - a)
  const hubThreshold = scores[Math.max(0, Math.floor(scores.length * 0.1) - 1)] ?? 0

  // Edges connected to hovered node
  const hoveredEdgeIds = new Set<string>()
  const hoveredNeighborIds = new Set<string>()
  if (hoveredNodeId) {
    hoveredNeighborIds.add(hoveredNodeId)
    for (const e of visibleEdges) {
      if (e.source === hoveredNodeId || e.target === hoveredNodeId) {
        hoveredEdgeIds.add(`${e.source}->${e.target}`)
        hoveredNeighborIds.add(e.source)
        hoveredNeighborIds.add(e.target)
      }
    }
  }

  const isHovering = hoveredNodeId !== null

  const rfNodes: Node[] = visibleNodes.map((n) => {
    const pos = positions.get(n.id) ?? { x: 0, y: 0 }
    const color = LANGUAGE_COLORS[n.language] ?? '#888'
    const isHub = n.score >= hubThreshold && hubThreshold > 0
    const dimmed = isHovering && !hoveredNeighborIds.has(n.id)

    return {
      id: n.id,
      position: pos,
      data: {
        label: n.folder ? `${n.label}\n${n.folder}` : n.label,
      },
      style: {
        fontSize: isHub ? 12 : 11,
        padding: '6px 10px',
        border: `2px solid ${color}`,
        borderRadius: 8,
        background: 'var(--color-card)',
        color: 'var(--color-foreground)',
        width: isHub ? 160 : 140,
        opacity: dimmed ? 0.1 : 1,
        transition: 'opacity 150ms ease',
        cursor: 'pointer',
      },
    }
  })

  const rfEdges: Edge[] = visibleEdges.map((e) => {
    const edgeKey = `${e.source}->${e.target}`
    const highlighted = hoveredEdgeIds.has(edgeKey)
    const dimmed = isHovering && !highlighted

    return {
      id: edgeKey,
      source: e.source,
      target: e.target,
      type: 'default',
      style: {
        stroke: 'var(--color-muted-foreground)',
        strokeOpacity: dimmed ? 0.05 : highlighted ? 0.8 : 0.3,
        strokeWidth: highlighted ? 2 : 1,
        transition: 'stroke-opacity 150ms ease, stroke-width 150ms ease',
      },
    }
  })

  return { nodes: rfNodes, edges: rfEdges, positions }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function GraphFlow() {
  const rootPath = useBrowserStore((s) => s.rootPath)
  const scanState = useGraphStore((s) => s.scanState)
  const scannedCount = useGraphStore((s) => s.scannedCount)
  const errorMessage = useGraphStore((s) => s.errorMessage)
  const allNodes = useGraphStore((s) => s.allNodes)
  const allEdges = useGraphStore((s) => s.allEdges)
  const showAll = useGraphStore((s) => s.showAll)
  const setShowAll = useGraphStore((s) => s.setShowAll)
  const truncated = useGraphStore((s) => s.truncated)
  const scan = useGraphStore((s) => s.scan)

  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)

  // Track last scanned rootPath so we don't re-scan on view switches
  const lastScannedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!rootPath || rootPath === lastScannedRef.current) return
    lastScannedRef.current = rootPath
    void scan(rootPath)
  }, [rootPath, scan])

  const visibleIds = useMemo(
    () => computeVisibleNodeIds(allNodes, showAll),
    [allNodes, showAll],
  )

  const { nodes, edges } = useMemo(
    () => toReactFlowData(allNodes, allEdges, visibleIds, hoveredNodeId),
    [allNodes, allEdges, visibleIds, hoveredNodeId],
  )

  const onNodeMouseEnter: NodeMouseHandler = useCallback((_event, node) => {
    setHoveredNodeId(node.id)
  }, [])

  const onNodeMouseLeave: NodeMouseHandler = useCallback(() => {
    setHoveredNodeId(null)
  }, [])

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    // Navigate to this file in the files view
    useViewStore.getState().setViewMode('files')
    void useCanvasStore.getState().focusFileByPath(node.id)
  }, [])

  // Language breakdown for stats
  const langStats = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of allNodes) {
      const short = LANGUAGE_SHORT[n.language] ?? n.language
      counts.set(short, (counts.get(short) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([lang, count]) => `${count} ${lang}`)
      .join(' · ')
  }, [allNodes])

  if (scanState === 'idle' || !rootPath) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No project open
      </div>
    )
  }

  if (scanState === 'error') {
    return (
      <div className="flex items-center justify-center h-full text-sm text-red-400">
        Graph build failed: {errorMessage}
      </div>
    )
  }

  const showOverlay = scanState === 'scanning' || (scanState === 'ready' && allNodes.length === 0)
  const visibleCount = visibleIds.size
  const totalCount = allNodes.length
  const edgeCount = allEdges.length
  const showToggle = totalCount > DEFAULT_HUB_COUNT

  return (
    <div className="absolute inset-0">
      {scanState === 'ready' && allNodes.length > 0 && (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          colorMode="dark"
          proOptions={proOptions}
          nodesDraggable={true}
          nodesConnectable={false}
          elementsSelectable={false}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          onNodeClick={onNodeClick}
          minZoom={0.1}
          maxZoom={2}
          fitView
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={2}
            color="var(--color-foreground)"
            style={{ opacity: 0.1 }}
          />
        </ReactFlow>
      )}

      {showOverlay && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-background/80">
          {scanState === 'scanning'
            ? `Scanning project... ${scannedCount} files`
            : 'No parseable source files found.'}
        </div>
      )}

      {/* Stats badge */}
      {scanState === 'ready' && allNodes.length > 0 && (
        <div className="absolute bottom-3 left-3 flex items-center gap-2 pointer-events-auto">
          <div className="px-2.5 py-1.5 rounded-lg bg-background/80 backdrop-blur-sm border border-border text-[11px] text-muted-foreground font-mono">
            {visibleCount} of {totalCount} files · {edgeCount} imports
            {langStats && <span> · {langStats}</span>}
            {truncated && <span className="text-yellow-500"> · truncated at 500</span>}
          </div>

          {showToggle && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="px-2.5 py-1.5 rounded-lg bg-background/80 backdrop-blur-sm border border-border text-[11px] text-muted-foreground font-mono hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              {showAll ? 'Show hubs only' : 'Show all'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function Graph() {
  return (
    <ReactFlowProvider>
      <GraphFlow />
    </ReactFlowProvider>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/grzegorzraczek/dev/priv/cotect && npx tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run full test suite**

```bash
cd /Users/grzegorzraczek/dev/priv/cotect && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/Graph/index.tsx
git commit -m "feat: rewrite graph view with force-directed layout and hub filtering"
```

---

### Task 7: Manual smoke test

**Files:** none (testing only)

- [ ] **Step 1: Start the dev server**

```bash
cd /Users/grzegorzraczek/dev/priv/cotect && yarn vite:dev
```

Open the app in a browser. Open a project with source files.

- [ ] **Step 2: Switch to graph view**

Press `2` to switch to the graph view. Verify:
- Scanning progress shows while building
- Nodes appear in a force-directed layout (clustered, not grid)
- Nodes are color-coded by language
- Stats badge shows file/edge counts in bottom-left
- "Show all" toggle appears if >30 files

- [ ] **Step 3: Test hover interaction**

Hover over a node. Verify:
- Hovered node's direct edges brighten
- All other nodes and edges dim to low opacity
- Moving off the node restores full opacity

- [ ] **Step 4: Test click-to-navigate**

Click a node. Verify:
- View switches to files view (view 1)
- The clicked file is focused in the file browser
- Pressing `2` returns to the graph with state preserved

- [ ] **Step 5: Test "Show all" toggle**

If the project has >30 files, click "Show all". Verify:
- All nodes appear
- Layout recalculates
- Button changes to "Show hubs only"
- Clicking again filters back to hub nodes

- [ ] **Step 6: Commit any fixes from smoke testing**

```bash
git add -u
git commit -m "fix: address issues found during graph view smoke testing"
```

Only commit if changes were made. Skip if everything worked.
