import { Suspense, lazy, useEffect, useRef } from 'react'
import { useHealthStore } from '@/store'
import { HEALTH_DATA, DEMO_ROOT } from '../demoData'

const Health = lazy(() => import('@/components/Health'))

export function HealthDemo() {
  const boxRef = useRef<HTMLDivElement>(null)
  const played = useRef(false)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    let timer: number | undefined
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || played.current) return
        played.current = true
        io.disconnect()
        // Safe to fake: Health's auto-analyze only fires when
        // analyzedRoot !== rootPath, and analyzedRoot stays DEMO_ROOT here.
        useHealthStore.setState({ scanState: 'analyzing', progress: 'Collecting file data...' })
        timer = window.setTimeout(() => {
          useHealthStore.setState({
            scanState: 'ready',
            progress: null,
            analyzedRoot: DEMO_ROOT,
            lastAnalyzedAt: Date.now(),
            ...HEALTH_DATA,
          })
        }, 1100)
      },
      { threshold: 0.4 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [])

  return (
    <div
      ref={boxRef}
      className="relative h-[480px] sm:h-[560px] rounded-lg border border-border overflow-hidden bg-background"
    >
      <Suspense fallback={<div className="h-full animate-pulse bg-[#1e1e1e]" />}>
        <Health />
      </Suspense>
    </div>
  )
}
