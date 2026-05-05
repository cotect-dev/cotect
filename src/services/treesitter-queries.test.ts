import { describe, it, expect } from 'vitest'
import { getConfigForFile } from '@/services/treesitter-queries'

describe('getConfigForFile', () => {
  it('returns typescript config for .ts files', () => {
    const config = getConfigForFile('src/main.ts')
    expect(config).not.toBeNull()
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
    expect(config!.extensions).toContain('.js')
  })

  it('returns javascript config for .jsx files', () => {
    const config = getConfigForFile('App.jsx')
    expect(config).not.toBeNull()
    expect(config!.extensions).toContain('.jsx')
  })

  it('returns null for unsupported extensions', () => {
    expect(getConfigForFile('style.css')).toBeNull()
    expect(getConfigForFile('data.json')).toBeNull()
    expect(getConfigForFile('readme.md')).toBeNull()
    expect(getConfigForFile('main.rs')).toBeNull()
  })

  it('handles files with multiple dots', () => {
    const config = getConfigForFile('my.component.test.tsx')
    expect(config).not.toBeNull()
    expect(config!.extensions).toContain('.tsx')
  })
})
