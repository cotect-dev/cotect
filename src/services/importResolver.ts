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

/** Number of leading path segments two directories share. */
function sharedDirDepth(a: string, b: string): number {
  const aSeg = a ? a.split('/') : []
  const bSeg = b ? b.split('/') : []
  let n = 0
  while (n < aSeg.length && n < bSeg.length && aSeg[n] === bSeg[n]) n++
  return n
}

const JS_RESOLVE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

function probeJsTsPath(resolved: string, fromRel: string, knownFiles: Set<string>): string | null {
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

function resolveJsTs(specifier: string, fromRel: string, knownFiles: Set<string>): string | null {
  // Handle @/ path alias (common Vite/TS convention: @/* → src/*)
  if (specifier.startsWith('@/')) {
    const aliasResolved = 'src/' + specifier.slice(2)
    return probeJsTsPath(aliasResolved, fromRel, knownFiles)
  }

  if (!specifier.startsWith('.')) return null

  const baseDir = dirname(fromRel)
  const segments = (baseDir ? baseDir.split('/') : []).concat(specifier.split('/'))
  const resolved = normalizePath(segments)

  return probeJsTsPath(resolved, fromRel, knownFiles)
}

function resolvePython(specifier: string, fromRel: string, knownFiles: Set<string>): string | null {
  const fromDir = dirname(fromRel)
  const fromSegments = fromDir ? fromDir.split('/') : []

  let dots = 0
  while (dots < specifier.length && specifier[dots] === '.') dots++

  if (dots > 0) {
    const rest = specifier.slice(dots)

    // Each dot beyond the first goes up one directory
    // from . import x → same package
    // from .. import x → parent package
    const parentCount = Math.max(0, dots - 1)
    const base = fromSegments.slice(0, fromSegments.length - parentCount)

    const moduleParts = rest ? rest.split('.') : []
    const searchPath = [...base, ...moduleParts].join('/')

    const pyCandidate = searchPath + '.py'
    if (knownFiles.has(pyCandidate) && pyCandidate !== fromRel) return pyCandidate

    const initCandidate = searchPath + '/__init__.py'
    if (knownFiles.has(initCandidate) && initCandidate !== fromRel) return initCandidate

    return null
  }

  const asPath = specifier.replace(/\./g, '/')

  // Absolute imports resolve against a sys.path entry, which we can't know
  // statically. First probe the importing file's own directory and every
  // ancestor up to the repo root, closest first: when the import root is the
  // file's own package tree — the common case, including nested roots like a
  // jobs folder placed on PYTHONPATH — the nearest match wins, matching Python.
  for (let i = fromSegments.length; i >= 0; i--) {
    const prefix = fromSegments.slice(0, i).join('/')
    const base = prefix ? prefix + '/' : ''

    const pyCandidate = base + asPath + '.py'
    if (knownFiles.has(pyCandidate) && pyCandidate !== fromRel) return pyCandidate

    const initCandidate = base + asPath + '/__init__.py'
    if (knownFiles.has(initCandidate) && initCandidate !== fromRel) return initCandidate
  }

  // The source root may instead be a sibling tree the ancestor walk cannot
  // reach: a src/ layout imported from tests/, or a monorepo lib dir of any
  // name. Match any file whose path ends with the module path and pick the root
  // closest to the importing file. Restricted to dotted (multi-segment) modules
  // because a bare `import yaml` that happens to hit a stray yaml.py elsewhere
  // in the repo is far more likely a third-party package than a real edge.
  if (specifier.includes('.')) {
    const suffixes = [asPath + '.py', asPath + '/__init__.py']
    const matches: string[] = []
    for (const f of knownFiles) {
      if (f === fromRel) continue
      if (suffixes.some((s) => f === s || f.endsWith('/' + s))) matches.push(f)
    }
    if (matches.length > 0) {
      const rootDepth = (f: string): number => {
        const matched = suffixes.find((s) => f === s || f.endsWith('/' + s))!
        const rootDir = f === matched ? '' : f.slice(0, f.length - matched.length - 1)
        return sharedDirDepth(rootDir, fromDir)
      }
      // Closest root first; then the shallowest, then a stable path order.
      matches.sort((a, b) => rootDepth(b) - rootDepth(a) || a.length - b.length || (a < b ? -1 : 1))
      return matches[0]
    }
  }

  return null
}

function resolveGo(specifier: string, _fromRel: string, knownFiles: Set<string>): string | null {
  if (specifier.indexOf('/') < 0) return null // stdlib single-word like "fmt"

  const segments = specifier.split('/')
  // Import paths start with the go.mod module name, which is rarely a
  // directory inside the repo: probe the path as-is, minus the module word
  // ("myapp/internal/db"), and minus a full domain module prefix
  // ("github.com/user/myapp/internal/db"). Domain imports that survive no
  // strip are external packages.
  const candidates: string[] = []
  if (!segments[0].includes('.')) {
    candidates.push(segments.join('/'), segments.slice(1).join('/'))
  } else if (segments.length > 3) {
    candidates.push(segments.slice(3).join('/'))
  }

  for (const candidate of candidates) {
    if (!candidate) continue
    const prefix = candidate + '/'
    for (const f of knownFiles) {
      if (f.startsWith(prefix) && f.endsWith('.go')) return f
    }
  }

  return null
}

function resolveRust(specifier: string, fromRel: string, knownFiles: Set<string>): string | null {
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

  let baseSegments: string[]
  let specParts: string[]

  if (specifier.startsWith('crate::')) {
    // The crate root is the nearest src/ directory above the importing
    // file, so nested crates (e.g. tauri/src) resolve too.
    const srcIdx = fromRel.lastIndexOf('/src/')
    const crateRoot = srcIdx >= 0 ? fromRel.slice(0, srcIdx + 4) : 'src'
    baseSegments = crateRoot.split('/')
    specParts = specifier.slice(7).split('::')
  } else if (specifier.startsWith('super::')) {
    const parentDir = dirname(dirname(fromRel))
    baseSegments = parentDir ? parentDir.split('/') : []
    specParts = specifier.slice(7).split('::')
  } else if (specifier.startsWith('self::')) {
    const fromDir = dirname(fromRel)
    baseSegments = fromDir ? fromDir.split('/') : []
    specParts = specifier.slice(6).split('::')
  } else {
    // External crate — no resolution
    return null
  }

  // The trailing segments of a use declaration are often items (functions,
  // structs) rather than modules: probe the full path first, then strip
  // from the right until a module file matches.
  for (let take = specParts.length; take >= 1; take--) {
    const basePath = [...baseSegments, ...specParts.slice(0, take)].join('/')

    const rsCandidate = basePath + '.rs'
    if (knownFiles.has(rsCandidate) && rsCandidate !== fromRel) return rsCandidate

    const modRsCandidate = basePath + '/mod.rs'
    if (knownFiles.has(modRsCandidate) && modRsCandidate !== fromRel) return modRsCandidate
  }

  return null
}

const RESOLVERS: Record<
  LanguageId,
  (spec: string, from: string, known: Set<string>) => string | null
> = {
  typescript: resolveJsTs,
  javascript: resolveJsTs,
  python: resolvePython,
  go: resolveGo,
  rust: resolveRust,
}

export function resolveImport(
  specifier: string,
  fromRel: string,
  knownFiles: Set<string>,
  language: LanguageId,
): string | null {
  return RESOLVERS[language](specifier, fromRel, knownFiles)
}
