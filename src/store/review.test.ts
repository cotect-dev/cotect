import { describe, it, expect, beforeEach } from 'vitest'
import {
  useReviewStore,
  hunkReviewed,
  fileProgress,
  overallProgress,
  type ReviewFile,
} from './review'

const files: ReviewFile[] = [
  {
    path: 'src/a.ts',
    status: 'M',
    insertions: 3,
    deletions: 1,
    hunks: [
      { start_line: 10, line_count: 2 },
      { start_line: 40, line_count: 1 },
    ],
  },
  {
    path: 'src/b.ts',
    status: 'A',
    insertions: 5,
    deletions: 0,
    hunks: [{ start_line: 1, line_count: 5 }],
  },
]

beforeEach(() => {
  useReviewStore.setState({ active: null, sessions: {} })
  useReviewStore.getState().startReview('abc1234', 'abc1234~1', 'tip999', files)
})

describe('review store — per-hunk', () => {
  it('startReview seeds an active session with files+hunks', () => {
    const s = useReviewStore.getState().active!
    expect(s.files).toEqual(files)
    expect(s.acceptedHunks.size).toBe(0)
    expect(s.comments).toEqual([])
  })

  it('acceptHunk / unacceptHunk toggle and persist', () => {
    const r = useReviewStore.getState()
    r.acceptHunk('src/a.ts', 10)
    expect(useReviewStore.getState().active!.acceptedHunks.has('src/a.ts:10')).toBe(true)
    expect(
      useReviewStore.getState().sessions['abc1234..tip999'].acceptedHunks.has('src/a.ts:10'),
    ).toBe(true)
    r.unacceptHunk('src/a.ts', 10)
    expect(useReviewStore.getState().active!.acceptedHunks.has('src/a.ts:10')).toBe(false)
    expect(
      useReviewStore.getState().sessions['abc1234..tip999'].acceptedHunks.has('src/a.ts:10'),
    ).toBe(false)
  })

  it('a hunk is reviewed when accepted OR commented', () => {
    const r = useReviewStore.getState()
    let s = useReviewStore.getState().active!
    expect(hunkReviewed(s, 'src/a.ts', 10)).toBe(false)
    r.acceptHunk('src/a.ts', 10)
    s = useReviewStore.getState().active!
    expect(hunkReviewed(s, 'src/a.ts', 10)).toBe(true)
    r.addComment('src/a.ts', 40, 40, 'code', 'fix this')
    s = useReviewStore.getState().active!
    expect(hunkReviewed(s, 'src/a.ts', 40)).toBe(true)
  })

  it('fileProgress and overallProgress count reviewed hunks', () => {
    const r = useReviewStore.getState()
    r.acceptHunk('src/a.ts', 10)
    r.addComment('src/a.ts', 40, 40, 'code', 'note')
    const s = useReviewStore.getState().active!
    expect(fileProgress(s, files[0])).toEqual({ reviewed: 2, total: 2 })
    expect(fileProgress(s, files[1])).toEqual({ reviewed: 0, total: 1 })
    expect(overallProgress(s)).toEqual({ reviewed: 2, total: 3 })
  })

  it('exportCommentsMarkdown renders path:range + body + snippet', () => {
    useReviewStore.getState().addComment('src/a.ts', 10, 11, 'const x = 1', 'rename x')
    const md = useReviewStore.getState().exportCommentsMarkdown()
    expect(md).toContain('src/a.ts:10-11')
    expect(md).toContain('rename x')
    expect(md).toContain('const x = 1')
  })

  it('re-entering the same base..tip restores accepted hunks + comments', () => {
    const r = useReviewStore.getState()
    r.acceptHunk('src/b.ts', 1)
    r.exitReview()
    expect(useReviewStore.getState().active).toBeNull()
    r.startReview('abc1234', 'abc1234~1', 'tip999', files)
    const s = useReviewStore.getState().active!
    expect(s.tipSha).toBe('tip999')
    expect(s.acceptedHunks.has('src/b.ts:1')).toBe(true)
  })

  it('re-reviewing the same base with a new tip starts fresh (no stale anchors)', () => {
    const r = useReviewStore.getState()
    r.acceptHunk('src/b.ts', 1)
    r.exitReview()
    r.startReview('abc1234', 'abc1234~1', 'tipNEW', files)
    const s = useReviewStore.getState().active!
    expect(s.tipSha).toBe('tipNEW')
    expect(s.acceptedHunks.size).toBe(0)
    expect(s.comments).toEqual([])
  })

  it('working-tree session does not collide with a commit review of the same sha', () => {
    const r = useReviewStore.getState()
    r.acceptHunk('src/a.ts', 10)
    r.exitReview()
    r.startReview('abc1234', 'HEAD', 'WORKING', [])
    expect(useReviewStore.getState().active!.acceptedHunks.size).toBe(0)
    const sessions = useReviewStore.getState().sessions
    expect(sessions['abc1234..tip999'].acceptedHunks.has('src/a.ts:10')).toBe(true)
    expect(sessions['abc1234..WORKING'].acceptedHunks.size).toBe(0)
  })
})
