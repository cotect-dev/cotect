import { invoke } from '@tauri-apps/api/core'

export const kvGet = (key: string) => invoke<unknown>('kv_get', { key })
export const kvSet = (key: string, value: unknown) => invoke<void>('kv_set', { key, value })
