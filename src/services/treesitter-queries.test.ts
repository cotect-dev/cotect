import { describe, it, expect } from 'vitest'
import { getConfigForFile, type LanguageId } from '@/services/treesitter-queries'

describe('getConfigForFile', () => {
  it('returns typescript config for .ts files', () => {
    const config = getConfigForFile('src/main.ts')
    expect(config).not.toBeNull()
    expect(config!.id).toBe('typescript' satisfies LanguageId)
    expect(config!.extensions).toContain('.ts')
  })

  it('returns typescript config for .tsx files', () => {
    const config = getConfigForFile('component.tsx')
    expect(config).not.toBeNull()
    expect(config!.extensions).toContain('.tsx')
  })

  it('returns javascript config for .js files', () => {
    const config = getConfigForFile('index.js')
    expect(config).not.toBeNull()
    expect(config!.id).toBe('javascript' satisfies LanguageId)
  })

  it('returns javascript config for .jsx files', () => {
    const config = getConfigForFile('App.jsx')
    expect(config).not.toBeNull()
    expect(config!.extensions).toContain('.jsx')
  })

  it('returns python config for .py files', () => {
    const config = getConfigForFile('main.py')
    expect(config).not.toBeNull()
    expect(config!.id).toBe('python' satisfies LanguageId)
    expect(config!.extensions).toContain('.py')
  })

  it('returns go config for .go files', () => {
    const config = getConfigForFile('main.go')
    expect(config).not.toBeNull()
    expect(config!.id).toBe('go' satisfies LanguageId)
    expect(config!.extensions).toContain('.go')
  })

  it('returns rust config for .rs files', () => {
    const config = getConfigForFile('lib.rs')
    expect(config).not.toBeNull()
    expect(config!.id).toBe('rust' satisfies LanguageId)
    expect(config!.extensions).toContain('.rs')
  })

  it('returns null for unsupported extensions', () => {
    expect(getConfigForFile('style.css')).toBeNull()
    expect(getConfigForFile('data.json')).toBeNull()
    expect(getConfigForFile('readme.md')).toBeNull()
  })

  it('handles files with multiple dots', () => {
    const config = getConfigForFile('my.component.test.tsx')
    expect(config).not.toBeNull()
    expect(config!.extensions).toContain('.tsx')
  })
})
