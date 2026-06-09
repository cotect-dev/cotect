import { useEffect, useState } from 'react'
import type { GitFileStatus } from '@/store/git'
import { toRepoRelative } from '@/lib/repoPath'

interface UseHeadContentOptions {
  filePath: string
  repoPath: string
  /** When set, HEAD is supplied directly (commit-range review) instead of loaded. */
  headOverride: string | null | undefined
  hasHeadOverride: boolean
  gitEntry: GitFileStatus | null
  isNewFile: boolean
  loadHeadContent: (repoRelativePath: string) => Promise<string | null>
}

/**
 * Resolves the file's HEAD content for the merge/diff view.
 *
 * Returns `undefined` while undetermined — callers use that to gate diff-derived
 * UI (deletion blocks, pills) so nothing renders against pre-merge coordinates.
 * Resolves to `''` for new files, `null` when the file is unchanged or has no
 * git entry, the override when one is supplied, or the committed text otherwise.
 */
export function useHeadContent({
  filePath,
  repoPath,
  headOverride,
  hasHeadOverride,
  gitEntry,
  isNewFile,
  loadHeadContent,
}: UseHeadContentOptions): string | null | undefined {
  // The repo-relative path whose HEAD needs an async load, or null when HEAD is
  // known synchronously (override / no git entry / new file).
  const loadPath =
    !hasHeadOverride && gitEntry && !isNewFile ? toRepoRelative(filePath, repoPath) : null

  // Async-loaded HEAD text, tagged with the path it was loaded for so a stale
  // result from a previously-shown file is ignored.
  const [loaded, setLoaded] = useState<{ path: string; content: string | null } | null>(null)

  useEffect(() => {
    if (loadPath === null) return
    let cancelled = false
    void loadHeadContent(loadPath).then((content) => {
      if (!cancelled) setLoaded({ path: loadPath, content })
    })
    return () => {
      cancelled = true
    }
    // gitEntry identity changes when git refreshes (e.g. HEAD moved while the
    // file still differs); re-load so the diff reflects the new HEAD.
  }, [loadPath, gitEntry, loadHeadContent])

  if (hasHeadOverride) return headOverride ?? null
  if (!gitEntry) return null
  if (isNewFile) return ''
  return loaded?.path === loadPath ? loaded.content : undefined
}
