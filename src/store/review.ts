import { create } from 'zustand'
import { createStoreWithHMR } from '@/lib/hmr'
import { withPersistence } from '@/store/persistence'

export interface ReviewHunk {
  start_line: number // after-side, 1-based
  line_count: number
}

export interface ReviewFile {
  path: string // repo-relative
  status: string // 'M' | 'A' | 'D' | 'R' | 'U'
  insertions: number
  deletions: number
  hunks: ReviewHunk[]
}

export interface ReviewComment {
  id: string
  filePath: string // repo-relative
  startLine: number // hunk start line in the after snapshot
  endLine: number
  snippet: string // hunk's after-side text at anchor time
  body: string
  createdAt: number
}

export interface ReviewSession {
  baseCommit: string
  baseRef: string
  tipSha: string
  startedAt: number
  files: ReviewFile[]
  acceptedHunks: Set<string> // keys: `${filePath}:${hunkStartLine}`
  comments: ReviewComment[]
}

interface PersistedSession extends Omit<ReviewSession, 'acceptedHunks'> {
  acceptedHunks: string[]
}

/** Sentinel `tipSha` for the implicit working-tree review — the session created
 *  on first accept/comment that simply annotates the live uncommitted changes
 *  (as opposed to a commit-baseline review started from History). */
export const WORKING_TIP = 'WORKING'

/** A commit-baseline review owns its own diff file list and read-only range
 *  diffs. The implicit working-tree review does not — it layers annotations on
 *  top of the always-visible working-tree changes. */
export function isCommitReview(s: ReviewSession): boolean {
  return s.tipSha !== WORKING_TIP
}

export function hunkKey(filePath: string, startLine: number): string {
  return `${filePath}:${startLine}`
}

export function hunkReviewed(session: ReviewSession, filePath: string, startLine: number): boolean {
  if (session.acceptedHunks.has(hunkKey(filePath, startLine))) return true
  return session.comments.some((c) => c.filePath === filePath && c.startLine === startLine)
}

export function fileProgress(
  session: ReviewSession,
  file: ReviewFile,
): { reviewed: number; total: number } {
  const reviewed = file.hunks.filter((h) => hunkReviewed(session, file.path, h.start_line)).length
  return { reviewed, total: file.hunks.length }
}

export function overallProgress(session: ReviewSession): { reviewed: number; total: number } {
  let reviewed = 0
  let total = 0
  for (const f of session.files) {
    const p = fileProgress(session, f)
    reviewed += p.reviewed
    total += p.total
  }
  return { reviewed, total }
}

interface ReviewState {
  active: ReviewSession | null
  sessions: Record<string, ReviewSession>
  startReview: (baseCommit: string, baseRef: string, tipSha: string, files: ReviewFile[]) => void
  exitReview: () => void
  acceptHunk: (filePath: string, startLine: number) => void
  unacceptHunk: (filePath: string, startLine: number) => void
  addComment: (
    filePath: string,
    startLine: number,
    endLine: number,
    snippet: string,
    body: string,
  ) => void
  updateComment: (id: string, body: string) => void
  removeComment: (id: string) => void
  exportCommentsMarkdown: () => string
}

function serializeSessions(
  sessions: Record<string, ReviewSession>,
): Record<string, PersistedSession> {
  const out: Record<string, PersistedSession> = {}
  for (const [k, s] of Object.entries(sessions)) {
    out[k] = { ...s, acceptedHunks: [...s.acceptedHunks] }
  }
  return out
}

function deserializeSessions(raw: unknown): Record<string, ReviewSession> {
  const out: Record<string, ReviewSession> = {}
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, PersistedSession>)) {
      out[k] = {
        ...v,
        baseCommit: v.baseCommit ?? k,
        baseRef: v.baseRef ?? '',
        tipSha: v.tipSha ?? '',
        startedAt: v.startedAt ?? 0,
        // Guard `hunks`: sessions persisted before per-hunk review lack it,
        // and `fileProgress` calls `file.hunks.filter`.
        files: (v.files ?? []).map((f) => ({ ...f, hunks: f.hunks ?? [] })),
        acceptedHunks: new Set(v.acceptedHunks ?? []),
        comments: v.comments ?? [],
      }
    }
  }
  return out
}

let commentSeq = 0
function nextCommentId(): string {
  commentSeq += 1
  return `cmt_${Date.now().toString(36)}_${commentSeq}`
}

function persistActive(
  active: ReviewSession | null,
  sessions: Record<string, ReviewSession>,
): Record<string, ReviewSession> {
  if (!active) return sessions
  return { ...sessions, [active.baseCommit]: active }
}

export const useReviewStore = createStoreWithHMR(import.meta.hot, 'review', () =>
  create<ReviewState>()(
    withPersistence(
      (set, get) => ({
        active: null,
        sessions: {},

        startReview: (baseCommit, baseRef, tipSha, files) => {
          const prior = get().sessions[baseCommit]
          const active: ReviewSession = {
            baseCommit,
            baseRef,
            tipSha,
            startedAt: Date.now(),
            files,
            acceptedHunks: prior ? new Set(prior.acceptedHunks) : new Set(),
            comments: prior ? [...prior.comments] : [],
          }
          set({ active, sessions: persistActive(active, get().sessions) })
        },

        exitReview: () => set({ active: null }),

        acceptHunk: (filePath, startLine) => {
          const active = get().active
          if (!active) return
          const acceptedHunks = new Set(active.acceptedHunks)
          acceptedHunks.add(hunkKey(filePath, startLine))
          const next = { ...active, acceptedHunks }
          set({ active: next, sessions: persistActive(next, get().sessions) })
        },

        unacceptHunk: (filePath, startLine) => {
          const active = get().active
          if (!active) return
          const acceptedHunks = new Set(active.acceptedHunks)
          acceptedHunks.delete(hunkKey(filePath, startLine))
          const next = { ...active, acceptedHunks }
          set({ active: next, sessions: persistActive(next, get().sessions) })
        },

        addComment: (filePath, startLine, endLine, snippet, body) => {
          const active = get().active
          if (!active) return
          const comment: ReviewComment = {
            id: nextCommentId(),
            filePath,
            startLine,
            endLine,
            snippet,
            body,
            createdAt: Date.now(),
          }
          const next = { ...active, comments: [...active.comments, comment] }
          set({ active: next, sessions: persistActive(next, get().sessions) })
        },

        updateComment: (id, body) => {
          const active = get().active
          if (!active) return
          const next = {
            ...active,
            comments: active.comments.map((c) => (c.id === id ? { ...c, body } : c)),
          }
          set({ active: next, sessions: persistActive(next, get().sessions) })
        },

        removeComment: (id) => {
          const active = get().active
          if (!active) return
          const next = { ...active, comments: active.comments.filter((c) => c.id !== id) }
          set({ active: next, sessions: persistActive(next, get().sessions) })
        },

        exportCommentsMarkdown: () => {
          const active = get().active
          if (!active || active.comments.length === 0) return ''
          const lines: string[] = [`## Review — commits since ${active.baseCommit.slice(0, 7)}`, '']
          const sorted = [...active.comments].sort(
            (a, b) => a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine,
          )
          for (const c of sorted) {
            const range =
              c.startLine === c.endLine ? `${c.startLine}` : `${c.startLine}-${c.endLine}`
            lines.push(`### ${c.filePath}:${range}`)
            lines.push('```')
            lines.push(c.snippet)
            lines.push('```')
            lines.push(c.body)
            lines.push('')
          }
          return lines.join('\n')
        },
      }),
      {
        name: 'review',
        fields: {
          sessions: {
            scope: 'project',
            serialize: (v) => serializeSessions(v as Record<string, ReviewSession>),
            deserialize: (raw) => deserializeSessions(raw),
          },
        },
        debounce: 500,
      },
    ),
  ),
)
