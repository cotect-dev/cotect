import { useEffect, useRef } from 'react'

export function useScrollToBottom(dep: unknown) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [dep])

  return bottomRef
}
