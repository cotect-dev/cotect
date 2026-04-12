import { invoke } from '@tauri-apps/api/core'

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function shortHash(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  return hashHex.slice(0, 8)
}

async function getGitRemoteUrl(repoPath: string): Promise<string | null> {
  try {
    const url = await invoke<string | null>('git_remote_url', { repoPath })
    return url || null
  } catch {
    return null
  }
}

export async function computeProjectId(rootPath: string): Promise<string> {
  const basename = rootPath.split('/').filter(Boolean).pop() || 'project'
  const slug = slugify(basename)

  const remoteUrl = await getGitRemoteUrl(rootPath)
  const hashInput = remoteUrl ?? rootPath
  const hash = await shortHash(hashInput)

  return `${slug}-${hash}`
}
