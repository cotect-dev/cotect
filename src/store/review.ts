import { create } from 'zustand'
import { createStoreWithHMR } from '@/lib/hmr'
import { withPersistence } from '@/store/persistence'

export interface ReviewFile {
  path: string // repo-relative
  status: string // 'M' | 'A' | 'D' | 'R' | 'U'
  insertions: number
  deletions: number
}

export interface ReviewComment {
  id: string
  filePath: string // repo-relative
  startLine: number // 1-based, in the head/after snapshot
  endLine: number
  snippet: string // reviewed code at anchor time (context + drift detection)
  body: string
  createdAt: number
}

export interface ReviewSession {
  baseCommit: string // selected commit C
  baseRef: string // resolved base diff ref (C~1 or empty-tree hash)
  tipSha: string // branch tip snapshot at review start
  startedAt: number
  files: ReviewFile[]
  viewedFiles: Set<string>
  comments: ReviewComment[]
}

interface PersistedSession extends Omit<ReviewSession, 'viewedFiles'> {
  viewedFiles: string[]
}

interface ReviewState {
  active: ReviewSession | null
  sessions: Record<string, ReviewSession> // keyed by baseCommit
  startReview: (baseCommit: string, baseRef: string, tipSha: string, files: ReviewFile[]) => void
  exitReview: () => void
  setViewed: (filePath: string, viewed: boolean) => void
}

// Persist `sessions` only. Sets need explicit (de)serialization.
function serializeSessions(
  sessions: Record<string, ReviewSession>,
): Record<string, PersistedSession> {
  const out: Record<string, PersistedSession> = {}
  for (const [k, s] of Object.entries(sessions)) {
    out[k] = { ...s, viewedFiles: [...s.viewedFiles] }
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
        viewedFiles: new Set(v.viewedFiles ?? []),
        comments: v.comments ?? [],
        files: v.files ?? [],
      }
    }
  }
  return out
}

// Persist the active session back into `sessions` after every mutation.
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
            viewedFiles: prior ? new Set(prior.viewedFiles) : new Set(),
            comments: prior ? [...prior.comments] : [],
          }
          set({ active, sessions: persistActive(active, get().sessions) })
        },

        exitReview: () => set({ active: null }),

        setViewed: (filePath, viewed) => {
          const active = get().active
          if (!active) return
          const viewedFiles = new Set(active.viewedFiles)
          if (viewed) viewedFiles.add(filePath)
          else viewedFiles.delete(filePath)
          const next = { ...active, viewedFiles }
          set({ active: next, sessions: persistActive(next, get().sessions) })
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
