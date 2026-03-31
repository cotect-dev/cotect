import { create, type StateCreator, type StoreApi } from 'zustand'
import { readJson, writeJsonSync, removeSync } from '@/services/storage'

function computeSerializableKeys(state: Record<string, unknown>): Set<string> {
  const keys = new Set<string>()
  for (const [key, value] of Object.entries(state)) {
    if (typeof value !== 'function') keys.add(key)
  }
  return keys
}

function pickKeys<T>(state: T, keys: Set<string>): Partial<T> {
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    result[key] = (state as Record<string, unknown>)[key]
  }
  return result as Partial<T>
}

interface PendingEntry {
  name: string
  store: StoreApi<unknown>
  serializableKeys: Set<string>
  sanitize?: (s: Partial<unknown>) => Partial<unknown>
}

const pending: PendingEntry[] = []

interface SyncOptions<T> {
  sanitize?: (saved: Partial<T>) => Partial<T>
}

const STORAGE_PREFIX = 'panel-'

export function createSyncedStore<T>(name: string, creator: StateCreator<T>, options?: SyncOptions<T>) {
  const store = create<T>(creator)
  const serializableKeys = computeSerializableKeys(store.getState() as Record<string, unknown>)
  pending.push({
    name,
    store: store as unknown as StoreApi<unknown>,
    serializableKeys,
    sanitize: options?.sanitize as ((s: Partial<unknown>) => Partial<unknown>) | undefined,
  })
  return store
}

export function initAllSyncedStores(): void {
  for (const entry of pending) {
    let timer: ReturnType<typeof setTimeout> | null = null
    entry.store.subscribe(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        writeJsonSync(`${STORAGE_PREFIX}${entry.name}`, pickKeys(entry.store.getState(), entry.serializableKeys))
      }, 300)
    })
  }
}

export function clearAllSyncedStores(): void {
  for (const { name } of pending) {
    removeSync(`${STORAGE_PREFIX}${name}`)
  }
}

export async function reloadSyncedStore(name: string): Promise<void> {
  const entry = pending.find((p) => p.name === name)
  if (!entry) return
  const saved = await readJson(`${STORAGE_PREFIX}${name}`)
  if (saved && typeof saved === 'object') {
    entry.store.setState(entry.sanitize ? entry.sanitize(saved as Partial<unknown>) : saved)
  }
}
