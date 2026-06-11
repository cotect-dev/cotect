import { Suspense, lazy } from 'react'

const Graph = lazy(() => import('@/components/Graph'))

export function GraphDemo() {
  return (
    <div className="relative h-[480px] sm:h-[640px] rounded-lg border border-border overflow-hidden bg-background">
      <Suspense fallback={<div className="h-full animate-pulse bg-[#1e1e1e]" />}>
        <Graph />
      </Suspense>
    </div>
  )
}
