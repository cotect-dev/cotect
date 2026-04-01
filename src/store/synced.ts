import { create, type StateCreator, type StoreApi } from 'zustand'
import { getPlatform } from '@/services/platform'

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

let unlisteners: (() => void)[] = []
let isSyncing = false

export function initAllSyncedStores(): void {
  const platform = getPlatform()
  const windowId = platform.windows.getWindowId()

  for (const entry of pending) {
    let timer: ReturnType<typeof setTimeout> | null = null
    entry.store.subscribe(() => {
      if (isSyncing) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const data = pickKeys(entry.store.getState(), entry.serializableKeys)
        platform.storage.setSync(`${STORAGE_PREFIX}${entry.name}`, data)
        platform.ipc.emit(`store-sync:${entry.name}`, { state: data, source: windowId }).catch(() => {})
      }, 300)
    })

    const unlisten = platform.ipc.listen(`store-sync:${entry.name}`, (payload: unknown) => {
      const { state, source } = payload as { state: Partial<unknown>; source: string }
      if (source !== windowId && state) {
        isSyncing = true
        entry.store.setState(entry.sanitize ? entry.sanitize(state) : state)
        isSyncing = false
      }
    })
    unlisteners.push(unlisten)
  }
}

export function clearAllSyncedStores(): void {
  const platform = getPlatform()
  for (const { name } of pending) {
    platform.storage.removeSync(`${STORAGE_PREFIX}${name}`)
  }
}

export function stopAllSyncedStores(): void {
  for (const unlisten of unlisteners) {
    unlisten()
  }
  unlisteners = []
}

export async function reloadSyncedStore(name: string): Promise<void> {
  const platform = getPlatform()
  const entry = pending.find((p) => p.name === name)
  if (!entry) return
  const saved = await platform.storage.get<Partial<unknown>>(`${STORAGE_PREFIX}${name}`)
  if (saved && typeof saved === 'object') {
    isSyncing = true
    entry.store.setState(entry.sanitize ? entry.sanitize(saved) : saved)
    isSyncing = false
  }
}
