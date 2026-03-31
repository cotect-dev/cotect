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

let parserInstance: Parser | null = null
const languageCache = new Map<string, Language>()
const queryCache = new Map<string, Query>()

async function getParser(): Promise<Parser> {
  if (!parserInstance) {
    await Parser.init({
      locateFile: () => '/tree-sitter.wasm',
    })
    parserInstance = new Parser()
  }
  return parserInstance
}

async function getLanguage(config: LanguageConfig): Promise<Language> {
  const cached = languageCache.get(config.grammarPath)
  if (cached) return cached
  const lang = await Language.load(config.grammarPath)
  languageCache.set(config.grammarPath, lang)
  return lang
}

function getQuery(language: Language, pattern: string): Query {
  const key = `${language}:${pattern}`
  const cached = queryCache.get(key)
  if (cached) return cached
  const query = new Query(language, pattern)
  queryCache.set(key, query)
  return query
}

function resolveImportPath(source: string, currentFilePath: string): string | null {
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

  const parser = await getParser()
  const language = await getLanguage(config)
  parser.setLanguage(language)

  const tree = parser.parse(content)
  if (!tree) return { declarations: [], imports: [] }

  // Extract declarations (queries are cached and reused across calls)
  const declQuery = getQuery(language, config.declarationQuery)
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

  // Extract imports
  const importQuery = getQuery(language, config.importQuery)
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

  return { declarations, imports }
}
