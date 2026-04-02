import { getPlatform } from '@/services/platform'

export interface ProjectMeta {
  name: string
  description: string | null
  version: string | null
  language: string | null
  framework: string | null
}

const FRAMEWORK_DEPS: Record<string, string> = {
  react: 'React',
  vue: 'Vue',
  angular: 'Angular',
  svelte: 'Svelte',
  next: 'Next.js',
  nuxt: 'Nuxt',
  '@tauri-apps/api': 'Tauri',
}

/**
 * Detect project metadata from config files at the root path.
 * Tries package.json, Cargo.toml, pyproject.toml, go.mod in order.
 */
export async function detectProjectMeta(rootPath: string): Promise<ProjectMeta> {
  const fallbackName = rootPath.split('/').pop() || 'Project'
  const meta: ProjectMeta = {
    name: fallbackName,
    description: null,
    version: null,
    language: null,
    framework: null,
  }

  const platform = getPlatform()

  // Try package.json (JavaScript/TypeScript)
  try {
    const content = await platform.fs.readFile(`${rootPath}/package.json`)
    const pkg = JSON.parse(content)
    if (pkg.name) meta.name = pkg.name
    if (pkg.description) meta.description = pkg.description
    if (pkg.version) meta.version = pkg.version
    meta.language = 'TypeScript'

    // Detect framework from dependencies
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
    for (const [dep, framework] of Object.entries(FRAMEWORK_DEPS)) {
      if (allDeps[dep]) {
        meta.framework = framework
        break
      }
    }

    return meta
  } catch {
    // No package.json or invalid
  }

  // Try Cargo.toml (Rust)
  try {
    const content = await platform.fs.readFile(`${rootPath}/Cargo.toml`)
    meta.language = 'Rust'
    const nameMatch = content.match(/^\s*name\s*=\s*"([^"]+)"/m)
    if (nameMatch) meta.name = nameMatch[1]
    const descMatch = content.match(/^\s*description\s*=\s*"([^"]+)"/m)
    if (descMatch) meta.description = descMatch[1]
    const verMatch = content.match(/^\s*version\s*=\s*"([^"]+)"/m)
    if (verMatch) meta.version = verMatch[1]
    return meta
  } catch {
    // No Cargo.toml
  }

  // Try pyproject.toml (Python)
  try {
    const content = await platform.fs.readFile(`${rootPath}/pyproject.toml`)
    meta.language = 'Python'
    const nameMatch = content.match(/^\s*name\s*=\s*"([^"]+)"/m)
    if (nameMatch) meta.name = nameMatch[1]
    const descMatch = content.match(/^\s*description\s*=\s*"([^"]+)"/m)
    if (descMatch) meta.description = descMatch[1]
    const verMatch = content.match(/^\s*version\s*=\s*"([^"]+)"/m)
    if (verMatch) meta.version = verMatch[1]
    return meta
  } catch {
    // No pyproject.toml
  }

  // Try go.mod (Go)
  try {
    const content = await platform.fs.readFile(`${rootPath}/go.mod`)
    meta.language = 'Go'
    const moduleMatch = content.match(/^module\s+(\S+)/m)
    if (moduleMatch) {
      const parts = moduleMatch[1].split('/')
      meta.name = parts[parts.length - 1]
    }
    return meta
  } catch {
    // No go.mod
  }

  return meta
}
