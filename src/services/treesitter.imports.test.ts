// @vitest-environment node
// End-to-end import extraction against the real grammar wasm files: these
// run in a node environment so web-tree-sitter reads the wasm from disk the
// same way the packaged app fetches it.
import { describe, it, expect, beforeAll } from 'vitest'
import { parseImports, setWasmBase } from '@/services/treesitter'

beforeAll(() => {
  setWasmBase('public/')
})

describe('python import extraction', () => {
  it('extracts plain and dotted imports', async () => {
    const specs = await parseImports('main.py', 'import os\nimport utils.helpers\n')
    expect(specs).toContain('os')
    expect(specs).toContain('utils.helpers')
  })

  it('extracts the module path from aliased imports, not the alias text', async () => {
    const specs = await parseImports('main.py', 'import utils.helpers as h\n')
    expect(specs).toContain('utils.helpers')
    expect(specs.some((s) => s.includes(' as '))).toBe(false)
  })

  it('extracts every module of a comma-separated import', async () => {
    const specs = await parseImports('main.py', 'import a.b, c.d\n')
    expect(specs).toContain('a.b')
    expect(specs).toContain('c.d')
  })

  it('emits per-name candidates for from-imports so module files resolve', async () => {
    const specs = await parseImports('pkg/main.py', 'from . import sibling\n')
    expect(specs).toContain('.sibling')
  })

  it('emits both the module and composite candidates for absolute from-imports', async () => {
    const specs = await parseImports('main.py', 'from utils.helpers import parse, dump\n')
    expect(specs).toContain('utils.helpers')
    expect(specs).toContain('utils.helpers.parse')
    expect(specs).toContain('utils.helpers.dump')
  })

  it('handles relative from-imports with module paths', async () => {
    const specs = await parseImports('pkg/sub/main.py', 'from ..core import engine\n')
    expect(specs).toContain('..core')
    expect(specs).toContain('..core.engine')
  })

  it('handles wildcard from-imports', async () => {
    const specs = await parseImports('main.py', 'from utils import *\n')
    expect(specs).toContain('utils')
  })
})

describe('rust import extraction', () => {
  it('extracts plain scoped use declarations and mod items', async () => {
    const specs = await parseImports('src/main.rs', 'mod config;\nuse crate::db::pool;\n')
    expect(specs).toContain('mod::config')
    expect(specs).toContain('crate::db::pool')
  })

  it('extracts the path from use lists, not the brace text', async () => {
    const specs = await parseImports('src/main.rs', 'use crate::db::{kv, migrations};\n')
    expect(specs).toContain('crate::db')
    expect(specs).toContain('crate::db::kv')
    expect(specs).toContain('crate::db::migrations')
    expect(specs.some((s) => s.includes('{'))).toBe(false)
  })

  it('extracts the path from aliased use declarations', async () => {
    const specs = await parseImports('src/main.rs', 'use crate::db as database;\n')
    expect(specs).toContain('crate::db')
    expect(specs.some((s) => s.includes(' as '))).toBe(false)
  })

  it('extracts the path from wildcard use declarations', async () => {
    const specs = await parseImports('src/main.rs', 'use crate::util::*;\n')
    expect(specs).toContain('crate::util')
  })
})

describe('go import extraction', () => {
  it('extracts import paths including named and grouped imports', async () => {
    const src = 'package main\nimport (\n\t"fmt"\n\t"myapp/internal/db"\n\tu "myapp/pkg/util"\n)\n'
    const specs = await parseImports('main.go', src)
    expect(specs).toContain('fmt')
    expect(specs).toContain('myapp/internal/db')
    expect(specs).toContain('myapp/pkg/util')
  })
})

describe('typescript import extraction', () => {
  it('extracts static, re-export, dynamic and require imports', async () => {
    const src = [
      "import { a } from './x'",
      "export { c } from '../y'",
      "const d = await import('./lazy')",
      "const e = require('./legacy')",
    ].join('\n')
    const specs = await parseImports('src/main.ts', src)
    expect(specs).toEqual(['./x', '../y', './lazy', './legacy'])
  })
})
