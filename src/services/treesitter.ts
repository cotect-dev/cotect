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
      // web-tree-sitter asks for "web-tree-sitter.wasm" but the file in
      // public/ is "tree-sitter.wasm". Ignore the requested name and
      // return the known path — same approach as the original loader.
      locateFile: () => `${WASM_BASE}tree-sitter.wasm`,
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
