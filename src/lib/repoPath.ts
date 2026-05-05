/**
 * Single owner of the abs-path ↔ repo-relative-path mapping. All helpers
 * are pure and tolerate the no-op cases (empty repoPath, already-absolute
 * input, repoPath with a trailing slash) so callers don't need to special-case.
 */

function stripTrailingSlash(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1)
  return path
}

/**
 * If the input is already repo-relative (does not start with `repoPath + '/'`)
 * it is returned unchanged — this also covers the empty-repoPath case.
 */
export function toRepoRelative(absOrRel: string, repoPath: string): string {
  if (!repoPath) return absOrRel
  const root = stripTrailingSlash(repoPath)
  const prefix = root + '/'
  if (absOrRel.startsWith(prefix)) return absOrRel.slice(prefix.length)
  return absOrRel
}

/** Inputs that already look absolute (leading `/`) are returned unchanged. */
export function toAbsolute(repoRelative: string, repoPath: string): string {
  if (repoRelative.startsWith('/')) return repoRelative
  const root = stripTrailingSlash(repoPath)
  return joinPath(root, repoRelative)
}

export function joinPath(parent: string, child: string): string {
  const left = stripTrailingSlash(parent)
  const right = child.startsWith('/') ? child.slice(1) : child
  if (!left) return right
  if (!right) return left
  return `${left}/${right}`
}

/**
 * Avoids the suffix-match trap: a naive `absPath.endsWith('/' + statusEntryPath)`
 * would match `repo/src/foo.ts` against status entry `foo.ts`.
 */
export function samePath(absOrRel: string, statusEntryPath: string, repoPath: string): boolean {
  return toRepoRelative(absOrRel, repoPath) === statusEntryPath
}
