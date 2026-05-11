function stripTrailingSlash(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1)
  return path
}

export function toRepoRelative(absOrRel: string, repoPath: string): string {
  if (!repoPath) return absOrRel
  const root = stripTrailingSlash(repoPath)
  const prefix = root + '/'
  if (absOrRel.startsWith(prefix)) return absOrRel.slice(prefix.length)
  return absOrRel
}

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

export function samePath(absOrRel: string, statusEntryPath: string, repoPath: string): boolean {
  return toRepoRelative(absOrRel, repoPath) === statusEntryPath
}
