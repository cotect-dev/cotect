import { useEffect, type RefObject } from 'react'

interface UseAutoSaveOptions {
  isReadOnly: boolean
  /** Live "has unsaved changes" flag, read via ref so the handlers stay stable. */
  dirtyRef: RefObject<boolean>
  /** While true, all automatic saving is held off — set when the file changed
   *  on disk under a dirty buffer, so a stale autosave can't clobber it. */
  suspendedRef: RefObject<boolean>
  saveToFile: () => Promise<boolean>
}

/** Persists editor changes without an explicit save: every 5s while dirty, and
 *  on tab-hide / before-unload. No-op when the editor is read-only. */
export function useAutoSave({
  isReadOnly,
  dirtyRef,
  suspendedRef,
  saveToFile,
}: UseAutoSaveOptions): void {
  // Periodic flush.
  useEffect(() => {
    if (isReadOnly) return
    const id = setInterval(() => {
      if (dirtyRef.current && !suspendedRef.current) void saveToFile()
    }, 5000)
    return () => clearInterval(id)
  }, [isReadOnly, dirtyRef, suspendedRef, saveToFile])

  // Flush on window focus loss and before close.
  useEffect(() => {
    if (isReadOnly) return
    const onVisibilityChange = () => {
      if (document.hidden && dirtyRef.current && !suspendedRef.current) void saveToFile()
    }
    const onBeforeUnload = () => {
      if (dirtyRef.current && !suspendedRef.current) void saveToFile()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [isReadOnly, dirtyRef, suspendedRef, saveToFile])
}
