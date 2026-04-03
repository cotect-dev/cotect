import { memo, useRef, useSyncExternalStore } from 'react'
import { formatRelativeTime } from '@/lib/time'

let tick = 0
const listeners = new Set<() => void>()

setInterval(() => {
  tick++
  for (const fn of listeners) fn()
}, 1_000)

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

function getSnapshot(): number {
  return tick
}

interface RelativeTimeProps {
  timestamp: number
  className?: string
}

/**
 * Only re-renders when the formatted text actually changes.
 * Without this, 50+ instances in History would all re-render every second.
 */
export default memo(function RelativeTime({ timestamp, className }: RelativeTimeProps) {
  const prevTextRef = useRef('')
  useSyncExternalStore(subscribe, getSnapshot)
  const text = formatRelativeTime(timestamp)

  // If the formatted text hasn't changed, reuse the previous ref to keep
  // React's reconciliation from touching the DOM.
  if (text === prevTextRef.current) {
    return <span className={className}>{prevTextRef.current}</span>
  }
  prevTextRef.current = text
  return <span className={className}>{text}</span>
})
