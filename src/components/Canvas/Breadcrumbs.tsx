import { memo, useMemo, useCallback } from 'react'
import { ChevronRight, Home } from 'lucide-react'
import { useCanvasStore } from '@/store'

export default memo(function Breadcrumbs() {
  const depthChain = useCanvasStore((s) => s.depthChain)
  const currentColumnIndex = useCanvasStore((s) => s.currentColumnIndex)

  const crumbs = useMemo(() => depthChain.map((path, i) => ({
    path,
    label: path.includes(':') ? path.split(':').pop()! : path.split('/').pop() || path,
    isCurrent: i === currentColumnIndex,
  })), [depthChain, currentColumnIndex])

  const navigateToColumn = useCallback((targetIndex: number) => {
    const current = useCanvasStore.getState().currentColumnIndex
    if (targetIndex === current) return
    if (targetIndex < current) {
      const steps = current - targetIndex
      for (let i = 0; i < steps; i++) {
        useCanvasStore.getState().navigateLeft()
      }
    }
  }, [])

  const navigateToRoot = useCallback(() => {
    const steps = useCanvasStore.getState().currentColumnIndex
    for (let i = 0; i < steps; i++) {
      useCanvasStore.getState().navigateLeft()
    }
  }, [])

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
      <div className="flex items-center gap-1 bg-background/90 backdrop-blur-md border border-border rounded-lg px-3 py-1.5 shadow-lg">
        <button
          className={`text-xs transition-colors ${currentColumnIndex === 0 ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}
          aria-label="Navigate to root"
          onClick={navigateToRoot}
          disabled={currentColumnIndex === 0}
        >
          <Home className="h-3.5 w-3.5" />
        </button>

        {crumbs.map((crumb, i) => (
          <div key={`${i}-${crumb.path}`} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            <button
              className={`text-xs transition-colors ${
                crumb.isCurrent
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => navigateToColumn(i)}
              disabled={crumb.isCurrent}
            >
              {crumb.label}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
})
