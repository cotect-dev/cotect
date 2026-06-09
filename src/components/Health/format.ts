/** Shorten a repo-relative path to its last two segments for compact display. */
export function shortPath(path: string): string {
  const parts = path.split('/')
  return parts.length > 2 ? parts.slice(-2).join('/') : path
}
