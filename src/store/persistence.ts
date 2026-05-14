import type { StateCreator, StoreApi } from 'zustand'
import { getPlatform } from '@/services/platform'

interface PersistFieldConfig<V = unknown> {
  scope: 'global' | 'project'
  serialize?: (value: V) => unknown
  deserialize?: (raw: unknown) => V
}

interface PersistOptions<T> {
  name: string
  fields: { [K in keyof T]?: PersistFieldConfig<T[K]> }
  debounce?: number
}

interface RegisteredStore {
  name: string
  store: StoreApi<unknown>
  fields: Record<string, PersistFieldConfig>
  defaults: Record<string, unknown>
  debounce: number
  unsubscribe: (() => void) | null
}

const registeredStores: RegisteredStore[] = []
let currentProjectId: string | null = null
let globalCache: Record<string, unknown> = {}
let projectCache: Record<string, unknown> = {}
let initialized = false
let unlisteners: (() => void)[] = []
let readyResolve: (() => void) | null = null
let readyPromise: Promise<void> | null = null

const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {}
const pendingGlobal: Record<string, unknown> = {}
const pendingProject: Record<string, unknown> = {}

function storageKey(scope: 'global' | 'project'): string {
  if (scope === 'global') return 'persist:global'
  return `persist:project:${currentProjectId}`
}

export function withPersistence<T>(
  creator: StateCreator<T, [], []>,
  options: PersistOptions<NoInfer<T>>,
): StateCreator<T, [], []> {
  return (set, get, api) => {
    const initialState = creator(set, get, api)

    const defaults: Record<string, unknown> = {}
    for (const [field] of Object.entries(options.fields)) {
      defaults[field] = (initialState as Record<string, unknown>)[field]
    }

    registeredStores.push({
      name: options.name,
      store: api as unknown as StoreApi<unknown>,
      fields: options.fields as Record<string, PersistFieldConfig>,
      defaults,
      debounce: options.debounce ?? 500,
      unsubscribe: null,
    })

    return initialState
  }
}

function serializeField(config: PersistFieldConfig, value: unknown): unknown {
  if (config.serialize) return config.serialize(value)
  if (value instanceof Set) return [...value]
  if (value instanceof Map) return Object.fromEntries(value)
  return value
}

function deserializeField(config: PersistFieldConfig, raw: unknown): unknown {
  if (config.deserialize) return config.deserialize(raw)
  return raw
}

function scheduleWrite(scope: 'global' | 'project', debounceMs: number) {
  const timerKey = scope
  if (debounceTimers[timerKey]) clearTimeout(debounceTimers[timerKey])

  debounceTimers[timerKey] = setTimeout(() => {
    flushScope(scope)
  }, debounceMs)
}

function flushScope(scope: 'global' | 'project') {
  const pending = scope === 'global' ? pendingGlobal : pendingProject
  const cache = scope === 'global' ? globalCache : projectCache

  if (Object.keys(pending).length === 0) return

  Object.assign(cache, pending)
  for (const key of Object.keys(pending)) {
    delete pending[key]
  }

  if (debounceTimers[scope]) {
    clearTimeout(debounceTimers[scope])
    delete debounceTimers[scope]
  }

  const platform = getPlatform()
  const key = storageKey(scope)
  const data = { ...cache }
  platform.storage.setSync(key, data)

  const windowId = platform.windows.getWindowId()
  platform.syncedState.set(key, data, windowId)
}

function startStoreSubscriptions() {
  for (const entry of registeredStores) {
    if (entry.unsubscribe) continue

    let prevState = entry.store.getState() as Record<string, unknown>

    entry.unsubscribe = entry.store.subscribe(() => {
      if (!initialized) return

      const state = entry.store.getState() as Record<string, unknown>

      for (const [field, config] of Object.entries(entry.fields)) {
        if (state[field] !== prevState[field]) {
          const key = `${entry.name}.${field}`
          const serialized = serializeField(config, state[field])

          if (config.scope === 'global') {
            pendingGlobal[key] = serialized
          } else {
            pendingProject[key] = serialized
          }

          scheduleWrite(config.scope, entry.debounce)
        }
      }

      prevState = state
    })
  }
}

function hydrateStores(
  globalData: Record<string, unknown> | null,
  projectData: Record<string, unknown> | null,
) {
  globalCache = globalData && typeof globalData === 'object' ? { ...globalData } : {}
  projectCache = projectData && typeof projectData === 'object' ? { ...projectData } : {}

  for (const entry of registeredStores) {
    const patch: Record<string, unknown> = {}

    for (const [field, config] of Object.entries(entry.fields)) {
      const key = `${entry.name}.${field}`
      const source = config.scope === 'global' ? globalCache : projectCache

      if (key in source) {
        patch[field] = deserializeField(config, source[key])
      }
    }

    if (Object.keys(patch).length > 0) {
      entry.store.setState(patch)
    }
  }
}

function startCrossWindowSync() {
  const platform = getPlatform()
  const windowId = platform.windows.getWindowId()

  const unlistenGlobal = platform.syncedState.listen(
    'persist:global',
    ({ state, source }: { state: unknown; source: string }) => {
      if (source === windowId || !state || typeof state !== 'object') return
      globalCache = { ...(state as Record<string, unknown>) }
      hydrateFromCache('global')
    },
  )
  unlisteners.push(unlistenGlobal)

  if (currentProjectId) {
    const ns = `persist:project:${currentProjectId}`
    const unlistenProject = platform.syncedState.listen(
      ns,
      ({ state, source }: { state: unknown; source: string }) => {
        if (source === windowId || !state || typeof state !== 'object') return
        projectCache = { ...(state as Record<string, unknown>) }
        hydrateFromCache('project')
      },
    )
    unlisteners.push(unlistenProject)
  }
}

function hydrateFromCache(scope: 'global' | 'project') {
  const cache = scope === 'global' ? globalCache : projectCache

  for (const entry of registeredStores) {
    const patch: Record<string, unknown> = {}

    for (const [field, config] of Object.entries(entry.fields)) {
      if (config.scope !== scope) continue
      const key = `${entry.name}.${field}`
      if (key in cache) {
        patch[field] = deserializeField(config, cache[key])
      }
    }

    if (Object.keys(patch).length > 0) {
      entry.store.setState(patch)
    }
  }
}

export function preparePersistence(): void {
  if (!readyPromise) {
    readyPromise = new Promise<void>((resolve) => {
      readyResolve = resolve
    })
  }
}

export async function initPersistence(projectId: string): Promise<void> {
  preparePersistence()

  currentProjectId = projectId
  const platform = getPlatform()

  const [globalData, projectData] = await Promise.all([
    platform.storage.get<Record<string, unknown>>(storageKey('global')),
    platform.storage.get<Record<string, unknown>>(storageKey('project')),
  ])

  hydrateStores(globalData, projectData)

  startStoreSubscriptions()
  startCrossWindowSync()
  initialized = true
  readyResolve?.()
}

export function waitForPersistence(): Promise<void> {
  return readyPromise ?? Promise.resolve()
}

export async function switchProject(newProjectId: string): Promise<void> {
  flushScope('project')

  for (const unlisten of unlisteners) {
    unlisten()
  }
  unlisteners = []

  currentProjectId = newProjectId

  const platform = getPlatform()
  const projectData = await platform.storage.get<Record<string, unknown>>(storageKey('project'))

  for (const entry of registeredStores) {
    const patch: Record<string, unknown> = {}
    for (const [field, config] of Object.entries(entry.fields)) {
      if (config.scope !== 'project') continue
      patch[field] = entry.defaults[field]
    }
    if (Object.keys(patch).length > 0) {
      entry.store.setState(patch)
    }
  }

  if (projectData && typeof projectData === 'object') {
    projectCache = { ...(projectData as Record<string, unknown>) }
    hydrateFromCache('project')
  } else {
    projectCache = {}
  }

  startCrossWindowSync()
}

/**
 * Reload a store's persisted fields from the backend. Used for cross-window
 * panel transfers where the receiving window needs latest state immediately.
 */
export async function reloadStoreFromBackend(storeName: string): Promise<void> {
  const platform = getPlatform()
  const entry = registeredStores.find((e) => e.name === storeName)
  if (!entry) return

  const [globalData, projectData] = await Promise.all([
    platform.storage.get<Record<string, unknown>>(storageKey('global')),
    currentProjectId
      ? platform.storage.get<Record<string, unknown>>(storageKey('project'))
      : Promise.resolve(null),
  ])

  const gData = globalData && typeof globalData === 'object' ? globalData : {}
  const pData = projectData && typeof projectData === 'object' ? projectData : {}

  const patch: Record<string, unknown> = {}
  for (const [field, config] of Object.entries(entry.fields)) {
    const key = `${entry.name}.${field}`
    const source = config.scope === 'global' ? gData : pData
    if (key in source) {
      patch[field] = deserializeField(config, source[key])
    }
  }

  if (Object.keys(patch).length > 0) {
    entry.store.setState(patch)
  }
}

export function flushPendingWrites(): void {
  flushScope('global')
  flushScope('project')
}

function resetReadyPromise() {
  readyResolve = null
  readyPromise = null
}

export function stopPersistence(): void {
  flushPendingWrites()

  for (const entry of registeredStores) {
    entry.unsubscribe?.()
    entry.unsubscribe = null
  }

  for (const unlisten of unlisteners) {
    unlisten()
  }
  unlisteners = []

  for (const key of Object.keys(debounceTimers)) {
    clearTimeout(debounceTimers[key])
    delete debounceTimers[key]
  }

  initialized = false
  resetReadyPromise()
}

/** Reset all module state. Only for tests. */
export function _testReset(): void {
  stopPersistence()
  registeredStores.length = 0
  globalCache = {}
  projectCache = {}
  currentProjectId = null
  for (const key of Object.keys(pendingGlobal)) delete pendingGlobal[key]
  for (const key of Object.keys(pendingProject)) delete pendingProject[key]
}
