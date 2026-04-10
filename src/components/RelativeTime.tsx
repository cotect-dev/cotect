import { memo, useMemo, useSyncExternalStore } from 'react'
import { formatRelativeTime } from '@/lib/time'

let tick = 0
const listeners = new Set<() => void>()

setInterval(() => {
  tick++
  for (const fn of listeners) fn()
}, 1_000)

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  return () => { listeners.delete(callback) }
}

function getSnapshot(): number {
  return tick
}

interface RelativeTimeProps {
  timestamp: number
  className?: string
}

export default memo(function RelativeTime({ timestamp, className }: RelativeTimeProps) {
  useSyncExternalStore(subscribe, getSnapshot)
  const text = formatRelativeTime(timestamp)
  // Memo returns the same JSX reference when text/className are unchanged,
  // letting React short-circuit reconciliation without touching the DOM.
  return useMemo(() => <span className={className}>{text}</span>, [text, className])
})
