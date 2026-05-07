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

  let pathParts: string[]
  let basePath: string

  if (specifier.startsWith('crate::')) {
    const rest = specifier.slice(7)
    pathParts = rest.split('::')
    basePath = 'src/' + pathParts.join('/')
  } else if (specifier.startsWith('super::')) {
    const rest = specifier.slice(7)
    const fromDir = dirname(fromRel)
    const parentDir = dirname(fromDir)
    const parentSegments = parentDir ? parentDir.split('/') : []
    pathParts = [...parentSegments, ...rest.split('::')]
    basePath = pathParts.join('/')
  } else if (specifier.startsWith('self::')) {
    const rest = specifier.slice(6)
    const fromDir = dirname(fromRel)
    const segments = fromDir ? fromDir.split('/') : []
    pathParts = [...segments, ...rest.split('::')]
    basePath = pathParts.join('/')
  } else {
    // External crate — no resolution
    return null
  }

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
