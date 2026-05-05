/**
 * Lazy web-tree-sitter loader and a minimal import-extractor used by the
 * Graph view. The Parser/Language WASM are fetched once and cached for the
 * lifetime of the page; subsequent calls reuse the same Parser instance.
 *
 * We deliberately keep the surface tiny — just `parseImports(filePath, src)` —
 * since the Graph view's only need today is "what does this file depend on?".
 * Extending to symbol extraction later means adding sibling helpers, not
 * reworking the loader.
 */
import { Parser, Language } from 'web-tree-sitter'

const WASM_BASE = '/'

let initPromise: Promise<void> | null = null
let tsPromise: Promise<Language> | null = null
let jsPromise: Promise<Language> | null = null
const parserPool: Parser[] = []

async function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init({
      // Vite serves /public/* at the root; the runtime loader uses this to
      // resolve `tree-sitter.wasm` next to the JS module.
      locateFile: (name: string) => `${WASM_BASE}${name}`,
    })
  }
  await initPromise
}

async function loadLanguageForFile(filename: string): Promise<Language | null> {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  if (ext === '.ts' || ext === '.tsx') {
    if (!tsPromise) {
      await ensureInit()
      tsPromise = Language.load(`${WASM_BASE}tree-sitter-typescript.wasm`)
    }
    return tsPromise
  }
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') {
    if (!jsPromise) {
      await ensureInit()
      jsPromise = Language.load(`${WASM_BASE}tree-sitter-javascript.wasm`)
    }
    return jsPromise
  }
  return null
}

function acquireParser(): Parser {
  return parserPool.pop() ?? new Parser()
}

function releaseParser(parser: Parser): void {
  parserPool.push(parser)
}

/**
 * Walks the parsed tree and returns the literal module specifiers from
 * `import` statements and `import(...)` / `require(...)` calls. Specifiers
 * that aren't string literals (template strings, dynamic expressions) are
 * skipped — they're not statically resolvable to a file path anyway.
 */
function collectImportSpecifiers(rootNode: import('web-tree-sitter').Node): string[] {
  const specifiers: string[] = []

  const stack: import('web-tree-sitter').Node[] = [rootNode]
  while (stack.length > 0) {
    const node = stack.pop()!
    const type = node.type

    if (type === 'import_statement' || type === 'export_statement') {
      // Source is a string literal child like `"./foo"`.
      const src = node.childForFieldName('source')
      const literal = readStringLiteral(src)
      if (literal !== null) specifiers.push(literal)
    } else if (type === 'call_expression') {
      // import('./foo') or require('./foo')
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

function readStringLiteral(node: import('web-tree-sitter').Node | null): string | null {
  if (!node) return null
  if (node.type !== 'string') return null
  const raw = node.text
  if (raw.length < 2) return null
  const quote = raw[0]
  if (quote !== '"' && quote !== "'") return null
  return raw.slice(1, -1)
}

/**
 * Parse `source` as the language implied by `filename`'s extension and return
 * the literal import specifiers found inside. Returns `[]` for unsupported
 * languages or parse failures — callers can treat it as "no edges".
 */
export async function parseImports(filename: string, source: string): Promise<string[]> {
  const language = await loadLanguageForFile(filename)
  if (!language) return []

  const parser = acquireParser()
  try {
    parser.setLanguage(language)
    const tree = parser.parse(source)
    if (!tree) return []
    try {
      return collectImportSpecifiers(tree.rootNode)
    } finally {
      tree.delete()
    }
  } catch {
    return []
  } finally {
    releaseParser(parser)
  }
}
