/**
 * Single owner of the abs-path ↔ repo-relative-path mapping. Three call
 * sites (CodeNode, canvas store, git store) used to do this conversion
 * inline with subtle variations — the worst being CodeNode's
 * `endsWith('/' + path)` suffix match, which can produce false positives
 * for files that share a common suffix (e.g. `repo/src/foo.ts` vs status
 * entry `foo.ts`).
 *
 * All helpers here are pure and tolerate the no-op cases (empty repoPath,
 * already-absolute input, repoPath with a trailing slash) so callers don't
 * need to special-case them.
 */

function stripTrailingSlash(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1)
  return path
}

/**
 * Convert an absolute path to a repo-relative path. If the input is already
 * repo-relative (does not start with `repoPath + '/'`) it is returned
 * unchanged — this also covers the empty-repoPath case.
 */
export function toRepoRelative(absOrRel: string, repoPath: string): string {
  if (!repoPath) return absOrRel
  const root = stripTrailingSlash(repoPath)
  const prefix = root + '/'
  if (absOrRel.startsWith(prefix)) return absOrRel.slice(prefix.length)
  return absOrRel
}

/**
 * Convert a repo-relative path to an absolute path. Defensive: if the
 * input already looks absolute (leading `/`) it is returned unchanged.
 */
export function toAbsolute(repoRelative: string, repoPath: string): string {
  if (repoRelative.startsWith('/')) return repoRelative
  const root = stripTrailingSlash(repoPath)
  return joinPath(root, repoRelative)
}

/**
 * Join a directory path with a child segment, collapsing duplicate slashes
 * at the boundary. Preserves a leading slash on `parent` when present.
 */
export function joinPath(parent: string, child: string): string {
  const left = stripTrailingSlash(parent)
  const right = child.startsWith('/') ? child.slice(1) : child
  if (!left) return right
  if (!right) return left
  return `${left}/${right}`
}

/**
 * Returns true when `absOrRel` and `statusEntryPath` refer to the same
 * file relative to `repoPath`. Replaces the old suffix-match check
 * (`absPath.endsWith('/' + statusEntryPath)`), which would match
 * `repo/src/foo.ts` against status entry `foo.ts` even though they are
 * different files.
 */
export function samePath(absOrRel: string, statusEntryPath: string, repoPath: string): boolean {
  return toRepoRelative(absOrRel, repoPath) === statusEntryPath
}
