import { describe, it, expect } from 'vitest'
import { toRepoRelative, toAbsolute, joinPath, samePath } from './repoPath'

describe('toRepoRelative', () => {
  it('strips the repoPath prefix from an absolute path inside the repo', () => {
    expect(toRepoRelative('/Users/me/proj/src/foo.ts', '/Users/me/proj')).toBe('src/foo.ts')
  })

  it('returns the input unchanged when repoPath is empty', () => {
    expect(toRepoRelative('/Users/me/proj/src/foo.ts', '')).toBe('/Users/me/proj/src/foo.ts')
  })

  it('returns the input unchanged when the path is outside the repo', () => {
    expect(toRepoRelative('/Users/other/code/file.ts', '/Users/me/proj')).toBe(
      '/Users/other/code/file.ts',
    )
  })

  it('returns the input unchanged when given a repo-relative path (no prefix to strip)', () => {
    expect(toRepoRelative('src/foo.ts', '/Users/me/proj')).toBe('src/foo.ts')
  })

  it('handles a repoPath with a trailing slash', () => {
    expect(toRepoRelative('/Users/me/proj/src/foo.ts', '/Users/me/proj/')).toBe('src/foo.ts')
  })

  it('does not match a path that merely shares a prefix substring', () => {
    // `/Users/me/proj-other/x.ts` is NOT inside `/Users/me/proj` even though
    // it shares the first N chars — guarded by requiring the trailing '/'.
    expect(toRepoRelative('/Users/me/proj-other/x.ts', '/Users/me/proj')).toBe(
      '/Users/me/proj-other/x.ts',
    )
  })

  it('returns empty string when the absolute path equals repoPath + "/"', () => {
    expect(toRepoRelative('/Users/me/proj/', '/Users/me/proj')).toBe('')
  })
})

describe('toAbsolute', () => {
  it('joins repoPath with a repo-relative path', () => {
    expect(toAbsolute('src/foo.ts', '/Users/me/proj')).toBe('/Users/me/proj/src/foo.ts')
  })

  it('avoids a double slash when repoPath ends with a slash', () => {
    expect(toAbsolute('src/foo.ts', '/Users/me/proj/')).toBe('/Users/me/proj/src/foo.ts')
  })

  it('returns an already-absolute input unchanged', () => {
    expect(toAbsolute('/abs/path/foo.ts', '/Users/me/proj')).toBe('/abs/path/foo.ts')
  })

  it('handles empty repoPath by returning the relative path as-is', () => {
    expect(toAbsolute('src/foo.ts', '')).toBe('src/foo.ts')
  })
})

describe('joinPath', () => {
  it('joins parent and child with a single slash', () => {
    expect(joinPath('/Users/me/proj', 'src')).toBe('/Users/me/proj/src')
  })

  it('strips trailing slash from parent', () => {
    expect(joinPath('/Users/me/proj/', 'src')).toBe('/Users/me/proj/src')
  })

  it('strips leading slash from child', () => {
    expect(joinPath('/Users/me/proj', '/src')).toBe('/Users/me/proj/src')
  })

  it('handles empty parent', () => {
    expect(joinPath('', 'src')).toBe('src')
  })

  it('handles empty child', () => {
    expect(joinPath('/Users/me/proj', '')).toBe('/Users/me/proj')
  })
})

describe('samePath', () => {
  it('returns true when an absolute path resolves to the status entry', () => {
    expect(samePath('/Users/me/proj/src/foo.ts', 'src/foo.ts', '/Users/me/proj')).toBe(true)
  })

  it('returns true when given a repo-relative path that matches', () => {
    expect(samePath('src/foo.ts', 'src/foo.ts', '/Users/me/proj')).toBe(true)
  })

  it('returns false for clearly different files', () => {
    expect(samePath('/Users/me/proj/src/foo.ts', 'src/bar.ts', '/Users/me/proj')).toBe(false)
  })

  it('returns false for the suffix-collision case the old endsWith check failed on', () => {
    // Status entry is `foo.ts` (a file at repo root). An absolute path of
    // `/Users/me/proj/src/foo.ts` is a DIFFERENT file. The old
    // `endsWith('/' + 'foo.ts')` check would incorrectly return true here.
    expect(samePath('/Users/me/proj/src/foo.ts', 'foo.ts', '/Users/me/proj')).toBe(false)
  })

  it('returns false when paths share a directory-name suffix but differ', () => {
    // Status entry is `lib/utils.ts`. Abs path is `/Users/me/proj/src/lib/utils.ts`
    // — same filename and parent dir name but different file. Old endsWith
    // would have returned true; samePath must say false.
    expect(samePath('/Users/me/proj/src/lib/utils.ts', 'lib/utils.ts', '/Users/me/proj')).toBe(
      false,
    )
  })

  it('returns true when the repo-rel form matches exactly', () => {
    expect(samePath('/Users/me/proj/src/lib/utils.ts', 'src/lib/utils.ts', '/Users/me/proj')).toBe(
      true,
    )
  })
})
