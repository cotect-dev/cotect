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

export interface ImportWithLine {
  specifier: string
  /** 1-based line number where the import/export statement begins. */
  line: number
}

export interface ImportWithBindings {
  specifier: string
  /** Named bindings imported from this specifier. Empty for side-effect imports / require(). */
  names: string[]
  line: number
}

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
// JS/TS binding extraction helpers
// ---------------------------------------------------------------------------

function collectImportClauseNames(node: TSNode, names: string[]): void {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)!
    if (child.type === 'identifier') {
      // Default import: `import Foo from ...`
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

// ---------------------------------------------------------------------------
// JS/TS extractor
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Python extractor
// ---------------------------------------------------------------------------

function collectPythonImportsWithLines(rootNode: TSNode): ImportWithLine[] {
  const results: ImportWithLine[] = []
  const stack: TSNode[] = [rootNode]
  while (stack.length > 0) {
    const node = stack.pop()!
    const type = node.type

    if (type === 'import_statement') {
      const name = node.childForFieldName('name')
      if (name) results.push({ specifier: name.text, line: node.startPosition.row + 1 })
    }
    if (type === 'import_from_statement') {
      const moduleName = node.childForFieldName('module_name')
      if (moduleName) {
        results.push({ specifier: moduleName.text, line: node.startPosition.row + 1 })
      } else {
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child && (child.type === 'relative_import' || child.type === 'dotted_name')) {
            results.push({ specifier: child.text, line: node.startPosition.row + 1 })
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
  return results
}

// ---------------------------------------------------------------------------
// Go extractor
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Rust extractor
// ---------------------------------------------------------------------------

function collectRustImportsWithLines(rootNode: TSNode): ImportWithLine[] {
  const results: ImportWithLine[] = []
  const stack: TSNode[] = [rootNode]
  while (stack.length > 0) {
    const node = stack.pop()!

    if (node.type === 'use_declaration') {
      const arg = node.namedChildren.find((c) =>
        c.type === 'scoped_identifier' ||
        c.type === 'use_as_clause' ||
        c.type === 'scoped_use_list' ||
        c.type === 'identifier'
      )
      if (arg) results.push({ specifier: arg.text, line: node.startPosition.row + 1 })
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

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const EXTRACTORS: Record<LanguageId, (root: TSNode) => ImportWithLine[]> = {
  typescript: collectJsTsImportsWithLines,
  javascript: collectJsTsImportsWithLines,
  python: collectPythonImportsWithLines,
  go: collectGoImportsWithLines,
  rust: collectRustImportsWithLines,
}

/**
 * Parse `source` as the language implied by `filename`'s extension and return
 * the literal import specifiers found inside. Returns `[]` for unsupported
 * languages or parse failures.
 */
export async function parseImports(filename: string, source: string): Promise<string[]> {
  const results = await parseImportsWithLines(filename, source)
  return results.map((r) => r.specifier)
}

/**
 * Like `parseImports` but also returns the 1-based line number of each
 * import/export statement. Used by the canvas to position reference nodes
 * at the source-code line where the dependency appears.
 */
export async function parseImportsWithLines(filename: string, source: string): Promise<ImportWithLine[]> {
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

/**
 * Like `parseImportsWithLines` but also extracts the named bindings from each
 * import statement (e.g. `import { foo, bar } from ...` → names: ['foo','bar']).
 * Currently JS/TS only; other languages return empty names arrays.
 */
export async function parseImportsWithBindings(filename: string, source: string): Promise<ImportWithBindings[]> {
  const loaded = await loadLanguageForFile(filename)
  if (!loaded) return []

  // Only JS/TS has a dedicated binding extractor; others fall through to
  // the line-only extractor with empty names arrays.
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
