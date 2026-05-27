import { invoke } from '@tauri-apps/api/core'

export const kvGet = (key: string) => invoke<unknown>('kv_get', { key })
export const kvSet = (key: string, value: unknown) => invoke<void>('kv_set', { key, value })
export const kvDelete = (key: string) => invoke<void>('kv_delete', { key })
export const kvGetPrefix = (prefix: string) =>
  invoke<Record<string, unknown>>('kv_get_prefix', { prefix })

export const dbRepoUpsert = (rootPath: string) => invoke<number>('db_repo_upsert', { rootPath })
export const dbRepoGet = (rootPath: string) =>
  invoke<{ id: number; root_path: string } | null>('db_repo_get', { rootPath })
