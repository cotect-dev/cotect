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

describe('review store — comments', () => {
  beforeEach(() => {
    useReviewStore.setState({ active: null, sessions: {} })
    useReviewStore.getState().startReview('abc1234', 'abc1234~1', 'tip999', files)
  })

  it('addComment adds a comment with a stable id and persists it', () => {
    const r = useReviewStore.getState()
    r.addComment('src/a.ts', 10, 12, 'const x = 1', 'use const-correct name')
    const c = useReviewStore.getState().active!.comments
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({
      filePath: 'src/a.ts',
      startLine: 10,
      endLine: 12,
      body: 'use const-correct name',
    })
    expect(c[0].id).toBeTruthy()
    expect(useReviewStore.getState().sessions['abc1234'].comments).toHaveLength(1)
  })

  it('updateComment and removeComment mutate by id', () => {
    const r = useReviewStore.getState()
    r.addComment('src/a.ts', 1, 1, 'x', 'first')
    const id = useReviewStore.getState().active!.comments[0].id
    r.updateComment(id, 'edited')
    expect(useReviewStore.getState().active!.comments[0].body).toBe('edited')
    r.removeComment(id)
    expect(useReviewStore.getState().active!.comments).toHaveLength(0)
  })

  it('exportCommentsMarkdown renders file:line + body', () => {
    const r = useReviewStore.getState()
    r.addComment('src/a.ts', 10, 12, 'const x = 1', 'rename x')
    const md = useReviewStore.getState().exportCommentsMarkdown()
    expect(md).toContain('src/a.ts:10-12')
    expect(md).toContain('rename x')
    expect(md).toContain('const x = 1')
  })
})
