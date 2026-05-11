import { useEffect, useRef, useState, useCallback } from 'react'
import { kvGet, kvSet } from '@/services/db'

/**
 * Read a typed value from the SQLite `kv` table; returns a setter that
 * persists with a debounce (default 500ms). Reads happen once on mount.
 *
 * The `defaultValue` is what the hook returns until `kv_get` resolves AND
 * what the caller gets when no row exists for the key.
 */
export function useKvField<T>(
  key: string,
  defaultValue: T,
  debounceMs = 500,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(defaultValue)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<T>(defaultValue)

  useEffect(() => {
    let cancelled = false
    void kvGet(key).then((raw) => {
      if (cancelled) return
      if (raw !== null && raw !== undefined) {
        setValue(raw as T)
      }
    })
    return () => { cancelled = true }
  }, [key])

  const set = useCallback((next: T) => {
    setValue(next)
    pending.current = next
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void kvSet(key, pending.current)
    }, debounceMs)
  }, [key, debounceMs])

  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current)
        void kvSet(key, pending.current)
      }
    }
  }, [key])

  return [value, set]
}
