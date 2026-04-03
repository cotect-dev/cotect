import { Parser, Query, Language, type QueryCapture } from 'web-tree-sitter'
import { getConfigForFile, type LanguageConfig } from './treesitter-queries'

export interface Declaration {
  name: string
  kind: 'function' | 'class'
  startLine: number
  endLine: number
  children: Declaration[] // methods for classes
}

export interface ImportInfo {
  source: string // raw import path
  resolvedPath: string | null // resolved to absolute path if relative
}

export interface FileAnalysis {
  declarations: Declaration[]
  imports: ImportInfo[]
}

let parserPromise: Promise<Parser> | null = null
const languageCache = new Map<string, Language>()
const queryCache = new Map<string, Query>()

let parseLock: Promise<void> = Promise.resolve()

function withParseLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = parseLock
  let resolve: () => void
  parseLock = new Promise<void>((r) => { resolve = r })
  return prev.then(fn).finally(() => resolve!())
}

async function getParser(): Promise<Parser> {
  if (!parserPromise) {
    parserPromise = (async () => {
      await Parser.init({ locateFile: () => '/tree-sitter.wasm' })
      return new Parser()
    })()
  }
  return parserPromise
}

async function getLanguage(config: LanguageConfig): Promise<Language> {
  const cached = languageCache.get(config.grammarPath)
  if (cached) return cached
  const lang = await Language.load(config.grammarPath)
  languageCache.set(config.grammarPath, lang)
  return lang
}

function getQuery(language: Language, grammarPath: string, pattern: string): Query {
  const key = `${grammarPath}:${pattern}`
  const cached = queryCache.get(key)
  if (cached) return cached
  const query = new Query(language, pattern)
  queryCache.set(key, query)
  return query
}

/** @internal Exported for testing only. */
export function resolveImportPath(source: string, currentFilePath: string): string | null {
  if (!source.startsWith('.')) return null // external package
  const dir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'))
  const parts = `${dir}/${source}`.split('/')
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '..') resolved.pop()
    else if (part !== '.') resolved.push(part)
  }
  return resolved.join('/')
}

export async function analyzeFile(filePath: string, content: string): Promise<FileAnalysis> {
  const config = getConfigForFile(filePath)
  if (!config) return { declarations: [], imports: [] }

  return withParseLock(async () => {
    const parser = await getParser()
    const language = await getLanguage(config)
    parser.setLanguage(language)

    const tree = parser.parse(content)
    if (!tree) return { declarations: [], imports: [] }

    const declQuery = getQuery(language, config.grammarPath, config.declarationQuery)
    const declMatches = declQuery.matches(tree.rootNode)
    const declarations: Declaration[] = []
    const classMap = new Map<number, Declaration>()

    for (const match of declMatches) {
      const declCapture = match.captures.find((c: QueryCapture) => c.name === 'decl')
      const nameCapture = match.captures.find((c: QueryCapture) => c.name === 'name')
      const methodCapture = match.captures.find((c: QueryCapture) => c.name === 'method')
      const methodNameCapture = match.captures.find((c: QueryCapture) => c.name === 'method_name')

      if (methodCapture && methodNameCapture) {
        let parent = methodCapture.node.parent
        while (parent && parent.type !== 'class_body') parent = parent.parent
        if (parent?.parent) {
          const classDecl = classMap.get(parent.parent.startPosition.row)
          if (classDecl) {
            classDecl.children.push({
              name: methodNameCapture.node.text,
              kind: 'function',
              startLine: methodCapture.node.startPosition.row,
              endLine: methodCapture.node.endPosition.row,
              children: [],
            })
          }
        }
        continue
      }

      if (declCapture && nameCapture) {
        const isClass = declCapture.node.type === 'class_declaration' ||
          (declCapture.node.type === 'export_statement' && declCapture.node.childForFieldName('declaration')?.type === 'class_declaration')
        const decl: Declaration = {
          name: nameCapture.node.text,
          kind: isClass ? 'class' : 'function',
          startLine: declCapture.node.startPosition.row,
          endLine: declCapture.node.endPosition.row,
          children: [],
        }
        declarations.push(decl)
        if (isClass) {
          const classNode = declCapture.node.type === 'export_statement'
            ? declCapture.node.childForFieldName('declaration')!
            : declCapture.node
          classMap.set(classNode.startPosition.row, decl)
        }
      }
    }

    const importQuery = getQuery(language, config.grammarPath, config.importQuery)
    const importMatches = importQuery.matches(tree.rootNode)
    const imports: ImportInfo[] = []

    for (const match of importMatches) {
      const sourceCapture = match.captures.find((c: QueryCapture) => c.name === 'source')
      if (sourceCapture) {
        imports.push({
          source: sourceCapture.node.text,
          resolvedPath: resolveImportPath(sourceCapture.node.text, filePath),
        })
      }
    }

    // Filter out nested (internal) functions: if a declaration's line range
    // is fully contained within another declaration, it's an inner function
    // and should not appear as a separate top-level entry.
    const topLevel = declarations.filter((decl) =>
      !declarations.some((other) =>
        other !== decl &&
        other.startLine <= decl.startLine &&
        other.endLine >= decl.endLine &&
        // Exclude exact same range (duplicates handled below)
        !(other.startLine === decl.startLine && other.endLine === decl.endLine)
      )
    )

    // Deduplicate declarations: exported items can match both the exported
    // and non-exported query patterns, producing two entries with the same name.
    // Keep the first (outermost) match for each name, which includes the export keyword.
    const seen = new Map<string, number>()
    const deduped: Declaration[] = []
    for (const decl of topLevel) {
      const existing = seen.get(decl.name)
      if (existing === undefined) {
        seen.set(decl.name, deduped.length)
        deduped.push(decl)
      } else {
        // Keep the one that spans more lines (the export-wrapped variant)
        const prev = deduped[existing]
        const prevSpan = prev.endLine - prev.startLine
        const currSpan = decl.endLine - decl.startLine
        if (currSpan > prevSpan) {
          deduped[existing] = { ...decl, children: [...prev.children, ...decl.children] }
        }
      }
    }

    return { declarations: deduped, imports }
  })
}
