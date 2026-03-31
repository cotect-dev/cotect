import { filesystem } from '@neutralinojs/lib'
import { isNeutralino } from './platform'

const NEU_PREFIX = '/tmp/cotect-'
const LS_PREFIX = 'cotect:'

function neuPath(key: string): string {
  return `${NEU_PREFIX}${key}.json`
}

function lsKey(key: string): string {
  return `${LS_PREFIX}${key}`
}

// ---------------------------------------------------------------------------
// readJson
// ---------------------------------------------------------------------------

export async function readJson<T>(key: string): Promise<T | null> {
  try {
    if (isNeutralino()) {
      const raw = await filesystem.readFile(neuPath(key))
      return JSON.parse(raw) as T
    } else {
      const raw = localStorage.getItem(lsKey(key))
      return raw ? (JSON.parse(raw) as T) : null
    }
  } catch (err) {
    console.warn(`[storage] readJson("${key}") failed:`, err)
    return null
  }
}

// ---------------------------------------------------------------------------
// writeJson (async)
// ---------------------------------------------------------------------------

export async function writeJson<T>(key: string, data: T): Promise<void> {
  const json = JSON.stringify(data)
  try {
    if (isNeutralino()) {
      await filesystem.writeFile(neuPath(key), json)
    } else {
      localStorage.setItem(lsKey(key), json)
    }
  } catch (err) {
    console.warn(`[storage] writeJson("${key}") failed:`, err)
  }
}

// ---------------------------------------------------------------------------
// writeJsonSync (fire-and-forget)
// ---------------------------------------------------------------------------

export function writeJsonSync<T>(key: string, data: T): void {
  const json = JSON.stringify(data)
  if (isNeutralino()) {
    filesystem.writeFile(neuPath(key), json).catch((err) => {
      console.warn(`[storage] writeJsonSync("${key}") failed:`, err)
    })
  } else {
    try {
      localStorage.setItem(lsKey(key), json)
    } catch (err) {
      console.warn(`[storage] writeJsonSync("${key}") failed:`, err)
    }
  }
}

// ---------------------------------------------------------------------------
// remove (async)
// ---------------------------------------------------------------------------

export async function remove(key: string): Promise<void> {
  try {
    if (isNeutralino()) {
      await filesystem.remove(neuPath(key))
    } else {
      localStorage.removeItem(lsKey(key))
    }
  } catch (err) {
    console.warn(`[storage] remove("${key}") failed:`, err)
  }
}

// ---------------------------------------------------------------------------
// removeSync (fire-and-forget)
// ---------------------------------------------------------------------------

export function removeSync(key: string): void {
  if (isNeutralino()) {
    filesystem.remove(neuPath(key)).catch((err) => {
      console.warn(`[storage] removeSync("${key}") failed:`, err)
    })
  } else {
    try {
      localStorage.removeItem(lsKey(key))
    } catch (err) {
      console.warn(`[storage] removeSync("${key}") failed:`, err)
    }
  }
}

// ---------------------------------------------------------------------------
// exists
// ---------------------------------------------------------------------------

export async function exists(key: string): Promise<boolean> {
  try {
    if (isNeutralino()) {
      await filesystem.getStats(neuPath(key))
      return true
    } else {
      return localStorage.getItem(lsKey(key)) !== null
    }
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// listKeys
// ---------------------------------------------------------------------------

export async function listKeys(prefix: string): Promise<string[]> {
  try {
    if (isNeutralino()) {
      const entries = await filesystem.readDirectory('/tmp')
      const filePrefix = `cotect-${prefix}`
      const keys: string[] = []
      for (const entry of entries) {
        if (
          entry.type === 'FILE' &&
          entry.entry.startsWith(filePrefix) &&
          entry.entry.endsWith('.json')
        ) {
          // Strip "cotect-" prefix and ".json" suffix to recover the key
          keys.push(entry.entry.slice('cotect-'.length, -'.json'.length))
        }
      }
      return keys
    } else {
      const lsPrefix = lsKey(prefix)
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith(lsPrefix)) {
          keys.push(k.slice(LS_PREFIX.length))
        }
      }
      return keys
    }
  } catch (err) {
    console.warn(`[storage] listKeys("${prefix}") failed:`, err)
    return []
  }
}
