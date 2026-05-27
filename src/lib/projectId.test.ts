import { describe, it, expect, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { computeProjectId, slugify, shortHash } from './projectId'
import { invoke } from '@tauri-apps/api/core'

const mockedInvoke = vi.mocked(invoke)

describe('slugify', () => {
  it('lowercases and replaces non-alphanumeric with hyphens', () => {
    expect(slugify('My Project')).toBe('my-project')
  })

  it('trims leading/trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello')
  })

  it('collapses consecutive hyphens', () => {
    expect(slugify('a   b___c')).toBe('a-b-c')
  })
})

describe('shortHash', () => {
  it('returns an 8 character hex string', async () => {
    const hash = await shortHash('https://github.com/user/repo.git')
    expect(hash).toMatch(/^[a-f0-9]{8}$/)
  })

  it('returns the same hash for the same input', async () => {
    const a = await shortHash('test')
    const b = await shortHash('test')
    expect(a).toBe(b)
  })

  it('returns different hashes for different inputs', async () => {
    const a = await shortHash('foo')
    const b = await shortHash('bar')
    expect(a).not.toBe(b)
  })
})

describe('computeProjectId', () => {
  it('uses git remote URL when available', async () => {
    mockedInvoke.mockResolvedValueOnce('https://github.com/user/repo.git')
    const id = await computeProjectId('/home/user/repo')
    expect(id).toMatch(/^repo-[a-f0-9]{8}$/)
  })

  it('falls back to absolute path when git remote fails', async () => {
    mockedInvoke.mockRejectedValueOnce(new Error('not a git repo'))
    const id = await computeProjectId('/home/user/my-project')
    expect(id).toMatch(/^my-project-[a-f0-9]{8}$/)
  })

  it('falls back to absolute path when remote returns null', async () => {
    mockedInvoke.mockResolvedValueOnce(null)
    const id = await computeProjectId('/home/user/project')
    expect(id).toMatch(/^project-[a-f0-9]{8}$/)
  })
})
