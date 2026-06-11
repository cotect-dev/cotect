import { Suspense, lazy } from 'react'

const Health = lazy(() => import('@/components/Health'))

export function HealthDemo() {
  return (
    <div className="relative h-[480px] sm:h-[560px] rounded-lg border border-border overflow-hidden bg-background">
      <Suspense fallback={<div className="h-full animate-pulse bg-[#1e1e1e]" />}>
        <Health />
      </Suspense>
    </div>
  )
}
