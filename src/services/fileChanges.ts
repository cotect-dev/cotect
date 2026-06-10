/**
 * Per-path notifications for files changed on disk by something other than us
 * (agents, editors, git operations). Fed by the repo file watcher; consumed by
 * open editors so they can reload or warn instead of showing stale content —
 * or worse, autosaving a stale buffer over a newer external write.
 */

type Listener = () => void

const listeners = new Map<string, Set<Listener>>()
const selfWrites = new Map<string, number>()

/** How long after our own write a watcher event for that path is ignored.
 *  Comfortably covers the watcher's 100ms debounce plus IPC latency. */
const SELF_WRITE_WINDOW_MS = 2000

/** Record that the app itself is writing `path`, so the resulting watcher
 *  event isn't misread as an external change. Call just before writing. */
export function markSelfWrite(path: string): void {
  selfWrites.set(path, Date.now())
}

/** Subscribe to external changes of an absolute file path. Returns unsubscribe. */
export function onExternalFileChange(path: string, fn: Listener): () => void {
  let set = listeners.get(path)
  if (!set) {
    set = new Set()
    listeners.set(path, set)
  }
  set.add(fn)
  return () => {
    set.delete(fn)
    if (set.size === 0) listeners.delete(path)
  }
}

/** Fan a watcher batch out to per-path subscribers, dropping our own writes. */
export function emitFileChanges(paths: string[]): void {
  const now = Date.now()
  for (const path of paths) {
    const writtenAt = selfWrites.get(path)
    if (writtenAt !== undefined) {
      if (now - writtenAt < SELF_WRITE_WINDOW_MS) continue
      selfWrites.delete(path)
    }
    const set = listeners.get(path)
    if (set) for (const fn of [...set]) fn()
  }
}

/** Reset all module state. Only for tests. */
export function _testReset(): void {
  listeners.clear()
  selfWrites.clear()
}
