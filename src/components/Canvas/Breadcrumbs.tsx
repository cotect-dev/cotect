import { ChevronRight, Home } from 'lucide-react'
import { useBrowserStore, useCanvasStore } from '@/store'

export default function Breadcrumbs() {
  const loading = useBrowserStore((s) => s.loading)
  const depthChain = useCanvasStore((s) => s.depthChain)
  const currentColumnIndex = useCanvasStore((s) => s.currentColumnIndex)

  // Build breadcrumb entries from the depth chain
  const crumbs = depthChain.map((path, i) => ({
    path,
    label: path.includes(':') ? path.split(':').pop()! : path.split('/').pop() || path,
    isCurrent: i === currentColumnIndex,
  }))

  function navigateToColumn(targetIndex: number) {
    if (targetIndex === currentColumnIndex) return
    if (targetIndex < currentColumnIndex) {
      // Navigate left repeatedly
      const steps = currentColumnIndex - targetIndex
      for (let i = 0; i < steps; i++) {
        useCanvasStore.getState().navigateLeft()
      }
    }
  }

  function navigateToRoot() {
    const steps = currentColumnIndex
    for (let i = 0; i < steps; i++) {
      useCanvasStore.getState().navigateLeft()
    }
  }

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

        {loading && (
          <div className="ml-2 h-3 w-3 border border-primary/50 border-t-primary rounded-full animate-spin" />
        )}
      </div>
    </div>
  )
}
