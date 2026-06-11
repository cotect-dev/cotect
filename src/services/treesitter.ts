import { Parser, Language } from 'web-tree-sitter'
import { getConfigForFile, type LanguageId } from '@/services/treesitter-queries'

type TSNode = import('web-tree-sitter').Node

let wasmBase = '/'

/** Test hook: lets vitest (node environment) load the wasm from disk. */
export function setWasmBase(base: string): void {
  wasmBase = base
}

let initPromise: Promise<void> | null = null
const languagePromises = new Map<string, Promise<Language>>()
const parserPool: Parser[] = []

async function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init({
      // web-tree-sitter asks for "web-tree-sitter.wasm" but the file in
      // public/ is "tree-sitter.wasm". Ignore the requested name and
      // return the known path — same approach as the original loader.
      locateFile: () => `${wasmBase}tree-sitter.wasm`,
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

async function loadLanguageForFile(
  filename: string,
): Promise<{ language: Language; id: LanguageId } | null> {
  const config = getConfigForFile(filename)
  if (!config) return null

  const wasmFile = WASM_MAP[config.id]
  if (!languagePromises.has(wasmFile)) {
    await ensureInit()
    languagePromises.set(wasmFile, Language.load(`${wasmBase}${wasmFile}`))
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

export interface ImportWithLine {
  specifier: string
  line: number
}

export interface ImportWithBindings {
  specifier: string
  names: string[]
  line: number
}

function readStringLiteral(node: TSNode | null): string | null {
  if (!node) return null
  if (
    node.type !== 'string' &&
    node.type !== 'interpreted_string_literal' &&
    node.type !== 'string_literal'
  )
    return null
  const raw = node.text
  if (raw.length < 2) return null
  const quote = raw[0]
  if (quote !== '"' && quote !== "'" && quote !== '`') return null
  return raw.slice(1, -1)
}

function collectImportClauseNames(node: TSNode, names: string[]): void {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)!
    if (child.type === 'identifier') {
      names.push(child.text)
    } else if (child.type === 'named_imports') {
      for (let j = 0; j < child.namedChildCount; j++) {
        const spec = child.namedChild(j)!
        if (spec.type === 'import_specifier') {
          const name = spec.childForFieldName('name')
          names.push(name?.text ?? spec.text)
        }
      }
    } else if (child.type === 'namespace_import') {
      names.push('*')
    }
  }
}

function collectJsTsImportsWithBindings(rootNode: TSNode): ImportWithBindings[] {
  const results: ImportWithBindings[] = []
  const stack: TSNode[] = [rootNode]
  while (stack.length > 0) {
    const node = stack.pop()!
    const type = node.type

    if (type === 'import_statement') {
      const src = node.childForFieldName('source')
      const literal = readStringLiteral(src)
      if (literal !== null) {
        const names: string[] = []
        const clause = node.namedChildren.find((c) => c.type === 'import_clause')
        if (clause) collectImportClauseNames(clause, names)
        results.push({ specifier: literal, names, line: node.startPosition.row + 1 })
      }
    } else if (type === 'export_statement') {
      const src = node.childForFieldName('source')
      const literal = readStringLiteral(src)
      if (literal !== null) {
        const names: string[] = []
        const exportClause = node.namedChildren.find((c) => c.type === 'export_clause')
        if (exportClause) {
          for (let j = 0; j < exportClause.namedChildCount; j++) {
            const spec = exportClause.namedChild(j)!
            if (spec.type === 'export_specifier') {
              const name = spec.childForFieldName('name')
              names.push(name?.text ?? spec.text)
            }
          }
        }
        results.push({ specifier: literal, names, line: node.startPosition.row + 1 })
      }
    } else if (type === 'call_expression') {
      const fn = node.childForFieldName('function')
      const args = node.childForFieldName('arguments')
      if (fn && args && (fn.type === 'import' || fn.text === 'require')) {
        const first = args.namedChildren[0]
        const literal = readStringLiteral(first ?? null)
        if (literal !== null) {
          results.push({ specifier: literal, names: [], line: node.startPosition.row + 1 })
        }
      }
    }

    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) stack.push(child)
    }
  }
  return results
}

function collectJsTsImportsWithLines(rootNode: TSNode): ImportWithLine[] {
  const results: ImportWithLine[] = []
  const stack: TSNode[] = [rootNode]
  while (stack.length > 0) {
    const node = stack.pop()!
    const type = node.type

    if (type === 'import_statement' || type === 'export_statement') {
      const src = node.childForFieldName('source')
      const literal = readStringLiteral(src)
      if (literal !== null) results.push({ specifier: literal, line: node.startPosition.row + 1 })
    } else if (type === 'call_expression') {
      const fn = node.childForFieldName('function')
      const args = node.childForFieldName('arguments')
      if (fn && args && (fn.type === 'import' || fn.text === 'require')) {
        const first = args.namedChildren[0]
        const literal = readStringLiteral(first ?? null)
        if (literal !== null) results.push({ specifier: literal, line: node.startPosition.row + 1 })
      }
    }

    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) stack.push(child)
    }
  }
  return results
}

// `import x.y as z` wraps the dotted path in an aliased_import; the module
// path lives in its name field. Plain imports are the dotted_name directly.
function pythonModulePath(nameNode: TSNode): string | null {
  if (nameNode.type === 'aliased_import') {
    return nameNode.childForFieldName('name')?.text ?? null
  }
  if (nameNode.type === 'dotted_name' || nameNode.type === 'relative_import') return nameNode.text
  return null
}

function collectPythonImportsWithLines(rootNode: TSNode): ImportWithLine[] {
  const results: ImportWithLine[] = []
  const stack: TSNode[] = [rootNode]
  while (stack.length > 0) {
    const node = stack.pop()!
    const type = node.type

    if (type === 'import_statement') {
      // `import a.b, c.d` carries one name field per module.
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (!child) continue
        const path = pythonModulePath(child)
        if (path) results.push({ specifier: path, line: node.startPosition.row + 1 })
      }
    }
    if (type === 'import_from_statement') {
      const line = node.startPosition.row + 1
      const moduleName =
        node.childForFieldName('module_name') ??
        node.namedChildren.find((c) => c.type === 'relative_import' || c.type === 'dotted_name') ??
        null
      if (moduleName) {
        const module = moduleName.text
        results.push({ specifier: module, line })
        // `from pkg import mod` may import a module file, which only the
        // joined path resolves; emit a candidate per imported name. Names
        // that turn out to be functions or classes simply fail resolution.
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (!child || child.equals(moduleName)) continue
          const name =
            child.type === 'aliased_import'
              ? (child.childForFieldName('name')?.text ?? null)
              : child.type === 'dotted_name'
                ? child.text
                : null
          if (!name) continue
          const joined = module.endsWith('.') ? module + name : `${module}.${name}`
          results.push({ specifier: joined, line })
        }
      }
    }

    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) stack.push(child)
    }
  }
  return results
}

function collectGoImportsWithLines(rootNode: TSNode): ImportWithLine[] {
  const results: ImportWithLine[] = []
  const stack: TSNode[] = [rootNode]
  while (stack.length > 0) {
    const node = stack.pop()!

    if (node.type === 'import_spec') {
      const path = node.childForFieldName('path')
      const literal = readStringLiteral(path)
      if (literal !== null) results.push({ specifier: literal, line: node.startPosition.row + 1 })
    }

    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) stack.push(child)
    }
  }
  return results
}

function collectRustImportsWithLines(rootNode: TSNode): ImportWithLine[] {
  const results: ImportWithLine[] = []
  const stack: TSNode[] = [rootNode]
  while (stack.length > 0) {
    const node = stack.pop()!

    if (node.type === 'use_declaration') {
      const line = node.startPosition.row + 1
      const arg = node.namedChildren.find(
        (c) =>
          c.type === 'scoped_identifier' ||
          c.type === 'use_as_clause' ||
          c.type === 'scoped_use_list' ||
          c.type === 'use_wildcard' ||
          c.type === 'identifier',
      )
      if (arg) {
        if (arg.type === 'scoped_use_list') {
          // `use a::b::{c, d}`: the brace text is not a path. Emit the stem
          // and one candidate per simple list entry (entries may be modules).
          const path = arg.childForFieldName('path')
          if (path) {
            results.push({ specifier: path.text, line })
            const list = arg.childForFieldName('list')
            for (const entry of list?.namedChildren ?? []) {
              if (entry.type === 'identifier' || entry.type === 'self') {
                if (entry.type === 'identifier') {
                  results.push({ specifier: `${path.text}::${entry.text}`, line })
                }
              }
            }
          }
        } else if (arg.type === 'use_as_clause') {
          const path = arg.childForFieldName('path')
          if (path) results.push({ specifier: path.text, line })
        } else if (arg.type === 'use_wildcard') {
          const path = arg.namedChildren.find(
            (c) => c.type === 'scoped_identifier' || c.type === 'identifier' || c.type === 'crate',
          )
          if (path) results.push({ specifier: path.text, line })
        } else {
          results.push({ specifier: arg.text, line })
        }
      }
    }

    if (node.type === 'mod_item') {
      const name = node.childForFieldName('name')
      if (name) results.push({ specifier: `mod::${name.text}`, line: node.startPosition.row + 1 })
    }

    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) stack.push(child)
    }
  }
  return results
}

const EXTRACTORS: Record<LanguageId, (root: TSNode) => ImportWithLine[]> = {
  typescript: collectJsTsImportsWithLines,
  javascript: collectJsTsImportsWithLines,
  python: collectPythonImportsWithLines,
  go: collectGoImportsWithLines,
  rust: collectRustImportsWithLines,
}

export async function parseImports(filename: string, source: string): Promise<string[]> {
  const results = await parseImportsWithLines(filename, source)
  return results.map((r) => r.specifier)
}

export async function parseImportsWithLines(
  filename: string,
  source: string,
): Promise<ImportWithLine[]> {
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

export async function parseImportsWithBindings(
  filename: string,
  source: string,
): Promise<ImportWithBindings[]> {
  const loaded = await loadLanguageForFile(filename)
  if (!loaded) return []

  if (loaded.id !== 'typescript' && loaded.id !== 'javascript') {
    const lines = await parseImportsWithLines(filename, source)
    return lines.map((l) => ({ ...l, names: [] }))
  }

  const parser = acquireParser()
  try {
    parser.setLanguage(loaded.language)
    const tree = parser.parse(source)
    if (!tree) return []
    try {
      return collectJsTsImportsWithBindings(tree.rootNode)
    } finally {
      tree.delete()
    }
  } catch {
    return []
  } finally {
    releaseParser(parser)
  }
}
