import { useEffect, type RefObject } from 'react'

interface UseAutoSaveOptions {
  isReadOnly: boolean
  /** Live "has unsaved changes" flag, read via ref so the handlers stay stable. */
  dirtyRef: RefObject<boolean>
  saveToFile: () => Promise<boolean>
}

/** Persists editor changes without an explicit save: every 5s while dirty, and
 *  on tab-hide / before-unload. No-op when the editor is read-only. */
export function useAutoSave({ isReadOnly, dirtyRef, saveToFile }: UseAutoSaveOptions): void {
  // Periodic flush.
  useEffect(() => {
    if (isReadOnly) return
    const id = setInterval(() => {
      if (dirtyRef.current) void saveToFile()
    }, 5000)
    return () => clearInterval(id)
  }, [isReadOnly, dirtyRef, saveToFile])

  // Flush on window focus loss and before close.
  useEffect(() => {
    if (isReadOnly) return
    const onVisibilityChange = () => {
      if (document.hidden && dirtyRef.current) void saveToFile()
    }
    const onBeforeUnload = () => {
      if (dirtyRef.current) void saveToFile()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [isReadOnly, dirtyRef, saveToFile])
}
