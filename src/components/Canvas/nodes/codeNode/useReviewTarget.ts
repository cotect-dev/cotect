import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  useReviewStore,
  WORKING_TIP,
  isCommitReview,
  workingSessionOf,
  type ReviewComment,
  type ReviewSession,
} from '@/store/review'
import { useGitStore } from '@/store/git'
import { toRepoRelative } from '@/lib/repoPath'

/** Session whose accepts/comments this node should display: the active one,
 *  else the persisted working session for the current HEAD (restores review
 *  marks after a restart without waiting for the first interaction). */
function displaySession(s: {
  active: ReviewSession | null
  sessions: Record<string, ReviewSession>
}): ReviewSession | null {
  return s.active ?? workingSessionOf(s, useGitStore.getState().log?.[0]?.hash)
}

export type HunkDisplay = {
  startLine: number
  endLine: number
  state: 'none' | 'accepted' | 'commented'
}

interface UseReviewTargetOptions {
  filePath: string
  repoPath: string
  /** True when the file has uncommitted changes — lets us review the working
   *  tree even without an explicit "Start review" session. */
  hasGitChanges: boolean
  /** `data.review?.filePath` — set when opened as a commit-range review diff. */
  dataReviewFilePath: string | undefined
  /** Hunks derived from the editor's own merge diff; used as the working-tree
   *  fallback when no formal session supplies hunks. */
  mergeHunks: { startLine: number; endLine: number }[]
}

interface UseReviewTargetResult {
  /** Repo-relative path under review, or undefined when there's nothing to review. */
  reviewFilePath: string | undefined
  fileComments: ReviewComment[]
  hunkDisplays: HunkDisplay[]
  /** Lazily opens an implicit working-tree review on first accept/comment. */
  ensureReviewSession: () => void
}

/**
 * Resolves the review context for a file and projects per-hunk accept/comment
 * state into a flat list the editor overlay can render.
 *
 * A file is "under review" when opened via Start review (`data.review`), when an
 * active session covers it, OR — the common case — whenever it simply has
 * uncommitted changes, so accept/comment controls show without an explicit review.
 */
export function useReviewTarget({
  filePath,
  repoPath,
  hasGitChanges,
  dataReviewFilePath,
  mergeHunks,
}: UseReviewTargetOptions): UseReviewTargetResult {
  const activeReviewFile = useReviewStore(
    useShallow((s) => {
      if (!s.active) return undefined
      const rel = toRepoRelative(filePath, repoPath)
      return s.active.files.some((f) => f.path === rel) ? rel : undefined
    }),
  )
  const reviewFilePath =
    dataReviewFilePath ??
    activeReviewFile ??
    (hasGitChanges && repoPath ? toRepoRelative(filePath, repoPath) : undefined)

  // Commit-review sessions anchor hunks/accepts/comments to the tip snapshot.
  // Only render them when this node is the range-diff view (`data.review` set);
  // a working-tree document opened from Files may have drifted from the tip.
  const isRangeDiffView = dataReviewFilePath !== undefined
  const fileComments = useReviewStore(
    useShallow((s) => {
      const session = displaySession(s)
      if (!reviewFilePath || !session) return [] as ReviewComment[]
      if (isCommitReview(session) && !isRangeDiffView) return [] as ReviewComment[]
      return session.comments.filter((c) => c.filePath === reviewFilePath)
    }),
  )
  const reviewHunks = useReviewStore(
    useShallow((s) => {
      if (!reviewFilePath || !s.active || !isRangeDiffView) return []
      return s.active.files.find((f) => f.path === reviewFilePath)?.hunks ?? []
    }),
  )
  // Hunks of the working tree vs HEAD as git computed them — the same ranges
  // the Changes panel counts, so accepting here moves the panel's progress.
  const workingHunks = useGitStore(
    useShallow((s) => {
      if (isRangeDiffView || !reviewFilePath) return []
      return s.workingDiff.find((f) => f.path === reviewFilePath)?.hunks ?? []
    }),
  )
  const acceptedStartLines = useReviewStore(
    useShallow((s) => {
      const session = displaySession(s)
      if (!reviewFilePath || !session) return [] as number[]
      if (isCommitReview(session) && !isRangeDiffView) return [] as number[]
      const prefix = `${reviewFilePath}:`
      return [...session.acceptedHunks]
        .filter((k) => k.startsWith(prefix))
        .map((k) => Number(k.slice(prefix.length)))
    }),
  )

  const hunkDisplays = useMemo<HunkDisplay[]>(() => {
    if (!reviewFilePath) return []
    const accepted = new Set(acceptedStartLines)
    const commented = new Set(fileComments.map((c) => c.startLine))
    const toRange = (h: { start_line: number; line_count: number }) => ({
      startLine: h.start_line,
      endLine: h.line_count > 0 ? h.start_line + h.line_count - 1 : h.start_line,
    })
    // Range reviews carry session hunks; working-tree files use git's own hunk
    // ranges (the ones the Changes panel counts) so accepts line up with its
    // progress; the editor's merge chunks remain the last-resort fallback.
    const src =
      reviewHunks.length > 0
        ? reviewHunks.map(toRange)
        : workingHunks.length > 0
          ? workingHunks.map(toRange)
          : mergeHunks
    return src.map((h) => ({
      startLine: h.startLine,
      endLine: h.endLine,
      state: accepted.has(h.startLine)
        ? 'accepted'
        : commented.has(h.startLine)
          ? 'commented'
          : 'none',
    }))
  }, [reviewFilePath, reviewHunks, workingHunks, mergeHunks, acceptedStartLines, fileComments])

  // Lazily open an implicit working-tree review the first time the user
  // accepts/comments without having started one from History, so their input
  // has somewhere to persist. Keyed by HEAD so it (and its accepts/comments) is
  // restored across remounts/reloads. Files are left empty — accept/comment are
  // keyed by path+line, and the Changes panel keeps showing the live
  // working-tree changes for a WORKING_TIP session rather than this file list.
  const ensureReviewSession = useCallback(() => {
    const rs = useReviewStore.getState()
    if (rs.active) return
    const headSha = useGitStore.getState().log?.[0]?.hash ?? 'working'
    rs.startReview(headSha, 'HEAD', WORKING_TIP, [])
  }, [])

  return { reviewFilePath, fileComments, hunkDisplays, ensureReviewSession }
}
