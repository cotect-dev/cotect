import { describe, it, expect, beforeEach } from 'vitest'
import { useReviewStore, type ReviewFile } from './review'

const files: ReviewFile[] = [
  { path: 'src/a.ts', status: 'M', insertions: 3, deletions: 1 },
  { path: 'src/b.ts', status: 'A', insertions: 5, deletions: 0 },
]

beforeEach(() => {
  useReviewStore.setState({ active: null, sessions: {} })
})

describe('review store — session + viewed', () => {
  it('startReview creates an active session', () => {
    useReviewStore.getState().startReview('abc1234', 'abc1234~1', 'tip999', files)
    const s = useReviewStore.getState().active!
    expect(s.baseCommit).toBe('abc1234')
    expect(s.baseRef).toBe('abc1234~1')
    expect(s.tipSha).toBe('tip999')
    expect(s.files).toEqual(files)
    expect(s.viewedFiles.size).toBe(0)
  })

  it('setViewed toggles a file and persists into sessions', () => {
    const r = useReviewStore.getState()
    r.startReview('abc1234', 'abc1234~1', 'tip999', files)
    r.setViewed('src/a.ts', true)
    expect(useReviewStore.getState().active!.viewedFiles.has('src/a.ts')).toBe(true)
    expect(useReviewStore.getState().sessions['abc1234'].viewedFiles.has('src/a.ts')).toBe(true)
    r.setViewed('src/a.ts', false)
    expect(useReviewStore.getState().active!.viewedFiles.has('src/a.ts')).toBe(false)
    expect(useReviewStore.getState().sessions['abc1234'].viewedFiles.has('src/a.ts')).toBe(false)
  })

  it('re-entering a base commit restores prior viewed state with a fresh tip', () => {
    const r = useReviewStore.getState()
    r.startReview('abc1234', 'abc1234~1', 'tip999', files)
    r.setViewed('src/b.ts', true)
    r.exitReview()
    expect(useReviewStore.getState().active).toBeNull()
    r.startReview('abc1234', 'abc1234~1', 'tipNEW', files)
    const s = useReviewStore.getState().active!
    expect(s.tipSha).toBe('tipNEW')
    expect(s.viewedFiles.has('src/b.ts')).toBe(true)
  })
})
