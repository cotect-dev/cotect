import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadFile = vi.fn()

vi.mock('@/services/platform', () => ({
  getPlatform: () => ({
    fs: {
      readFile: mockReadFile,
    },
  }),
}))

import { detectProjectMeta } from './projectMeta'

describe('detectProjectMeta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('fallback behavior', () => {
    it('returns folder name as project name when no config files found', async () => {
      mockReadFile.mockRejectedValue(new Error('not found'))

      const meta = await detectProjectMeta('/home/user/my-project')

      expect(meta.name).toBe('my-project')
      expect(meta.description).toBeNull()
      expect(meta.version).toBeNull()
      expect(meta.language).toBeNull()
      expect(meta.framework).toBeNull()
    })

    it('uses "Project" as fallback when path has no segments', async () => {
      mockReadFile.mockRejectedValue(new Error('not found'))

      const meta = await detectProjectMeta('')

      expect(meta.name).toBe('Project')
    })
  })

  describe('package.json (JavaScript/TypeScript)', () => {
    it('detects name, description, version from package.json', async () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path === '/proj/package.json') {
          return Promise.resolve(JSON.stringify({
            name: 'my-app',
            description: 'A cool app',
            version: '2.1.0',
          }))
        }
        return Promise.reject(new Error('not found'))
      })

      const meta = await detectProjectMeta('/proj')

      expect(meta.name).toBe('my-app')
      expect(meta.description).toBe('A cool app')
      expect(meta.version).toBe('2.1.0')
      expect(meta.language).toBe('TypeScript')
    })

    it('detects React framework from dependencies', async () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path === '/proj/package.json') {
          return Promise.resolve(JSON.stringify({
            name: 'app',
            dependencies: { react: '^18.0.0' },
          }))
        }
        return Promise.reject(new Error('not found'))
      })

      const meta = await detectProjectMeta('/proj')
      expect(meta.framework).toBe('React')
    })

    it('detects Vue framework from dependencies', async () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path === '/proj/package.json') {
          return Promise.resolve(JSON.stringify({
            name: 'app',
            dependencies: { vue: '^3.0.0' },
          }))
        }
        return Promise.reject(new Error('not found'))
      })

      const meta = await detectProjectMeta('/proj')
      expect(meta.framework).toBe('Vue')
    })

    it('detects Tauri framework from @tauri-apps/api dependency', async () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path === '/proj/package.json') {
          return Promise.resolve(JSON.stringify({
            name: 'app',
            dependencies: { '@tauri-apps/api': '^2' },
          }))
        }
        return Promise.reject(new Error('not found'))
      })

      const meta = await detectProjectMeta('/proj')
      expect(meta.framework).toBe('Tauri')
    })

    it('detects framework from devDependencies', async () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path === '/proj/package.json') {
          return Promise.resolve(JSON.stringify({
            name: 'app',
            devDependencies: { svelte: '^4.0.0' },
          }))
        }
        return Promise.reject(new Error('not found'))
      })

      const meta = await detectProjectMeta('/proj')
      expect(meta.framework).toBe('Svelte')
    })

    it('picks the first matching framework when multiple exist', async () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path === '/proj/package.json') {
          return Promise.resolve(JSON.stringify({
            name: 'app',
            dependencies: { react: '^18', next: '^14' },
          }))
        }
        return Promise.reject(new Error('not found'))
      })

      const meta = await detectProjectMeta('/proj')
      // The first match from FRAMEWORK_DEPS iteration wins (react comes before next)
      expect(meta.framework).toBe('React')
    })

    it('returns null framework when no known framework dependency', async () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path === '/proj/package.json') {
          return Promise.resolve(JSON.stringify({
            name: 'app',
            dependencies: { express: '^4' },
          }))
        }
        return Promise.reject(new Error('not found'))
      })

      const meta = await detectProjectMeta('/proj')
      expect(meta.framework).toBeNull()
    })

    it('uses folder name if package.json has no name field', async () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path === '/proj/package.json') {
          return Promise.resolve(JSON.stringify({ version: '1.0.0' }))
        }
        return Promise.reject(new Error('not found'))
      })

      const meta = await detectProjectMeta('/proj')
      // name should remain the fallback folder name
      expect(meta.name).toBe('proj')
    })
  })

  describe('Cargo.toml (Rust)', () => {
    it('detects Rust project from Cargo.toml', async () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path === '/proj/Cargo.toml') {
          return Promise.resolve(
            `[package]\nname = "my-rust-app"\ndescription = "A Rust project"\nversion = "0.3.1"\n`
          )
        }
        return Promise.reject(new Error('not found'))
      })

      const meta = await detectProjectMeta('/proj')

      expect(meta.name).toBe('my-rust-app')
      expect(meta.description).toBe('A Rust project')
      expect(meta.version).toBe('0.3.1')
      expect(meta.language).toBe('Rust')
      expect(meta.framework).toBeNull()
    })

    it('handles Cargo.toml with only name', async () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path === '/proj/Cargo.toml') {
          return Promise.resolve(`[package]\nname = "minimal"\n`)
        }
        return Promise.reject(new Error('not found'))
      })

      const meta = await detectProjectMeta('/proj')
      expect(meta.name).toBe('minimal')
      expect(meta.description).toBeNull()
      expect(meta.version).toBeNull()
      expect(meta.language).toBe('Rust')
    })
  })

  describe('pyproject.toml (Python)', () => {
    it('detects Python project from pyproject.toml', async () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path === '/proj/pyproject.toml') {
          return Promise.resolve(
            `[project]\nname = "my-py-app"\ndescription = "A Python project"\nversion = "1.2.3"\n`
          )
        }
        return Promise.reject(new Error('not found'))
      })

      const meta = await detectProjectMeta('/proj')

      expect(meta.name).toBe('my-py-app')
      expect(meta.description).toBe('A Python project')
      expect(meta.version).toBe('1.2.3')
      expect(meta.language).toBe('Python')
      expect(meta.framework).toBeNull()
    })
  })

  describe('go.mod (Go)', () => {
    it('detects Go project from go.mod', async () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path === '/proj/go.mod') {
          return Promise.resolve(`module github.com/user/my-go-app\n\ngo 1.21\n`)
        }
        return Promise.reject(new Error('not found'))
      })

      const meta = await detectProjectMeta('/proj')

      expect(meta.name).toBe('my-go-app')
      expect(meta.language).toBe('Go')
      expect(meta.description).toBeNull()
      expect(meta.version).toBeNull()
      expect(meta.framework).toBeNull()
    })

    it('extracts last segment of module path as name', async () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path === '/proj/go.mod') {
          return Promise.resolve(`module example.com/org/deep/nested/pkg\n`)
        }
        return Promise.reject(new Error('not found'))
      })

      const meta = await detectProjectMeta('/proj')
      expect(meta.name).toBe('pkg')
    })
  })

  describe('priority order', () => {
    it('prefers package.json over Cargo.toml', async () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path === '/proj/package.json') {
          return Promise.resolve(JSON.stringify({ name: 'js-app' }))
        }
        if (path === '/proj/Cargo.toml') {
          return Promise.resolve(`[package]\nname = "rs-app"\n`)
        }
        return Promise.reject(new Error('not found'))
      })

      const meta = await detectProjectMeta('/proj')
      expect(meta.name).toBe('js-app')
      expect(meta.language).toBe('TypeScript')
    })

    it('falls back to Cargo.toml when package.json is missing', async () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path === '/proj/Cargo.toml') {
          return Promise.resolve(`[package]\nname = "rs-app"\n`)
        }
        return Promise.reject(new Error('not found'))
      })

      const meta = await detectProjectMeta('/proj')
      expect(meta.name).toBe('rs-app')
      expect(meta.language).toBe('Rust')
    })

    it('falls back to pyproject.toml when package.json and Cargo.toml are missing', async () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path === '/proj/pyproject.toml') {
          return Promise.resolve(`[project]\nname = "py-app"\n`)
        }
        return Promise.reject(new Error('not found'))
      })

      const meta = await detectProjectMeta('/proj')
      expect(meta.name).toBe('py-app')
      expect(meta.language).toBe('Python')
    })

    it('falls back to go.mod as last option', async () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path === '/proj/go.mod') {
          return Promise.resolve(`module github.com/user/go-app\n`)
        }
        return Promise.reject(new Error('not found'))
      })

      const meta = await detectProjectMeta('/proj')
      expect(meta.name).toBe('go-app')
      expect(meta.language).toBe('Go')
    })
  })
})
