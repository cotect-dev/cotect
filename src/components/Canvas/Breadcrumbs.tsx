import { memo, useMemo } from 'react'
import { ChevronRight, Home } from 'lucide-react'
import { useCanvasStore } from '@/store'

function crumbLabel(path: string): string {
  if (path.includes(':')) return path.split(':').pop()!
  return path.split('/').pop() || path
}

export default memo(function Breadcrumbs() {
  const depthChain = useCanvasStore((s) => s.depthChain)
  const currentColumnIndex = useCanvasStore((s) => s.currentColumnIndex)

  const crumbs = useMemo(
    () => depthChain.map((path, i) => ({ path, label: crumbLabel(path), isCurrent: i === currentColumnIndex })),
    [depthChain, currentColumnIndex],
  )

  const navigateTo = (i: number) => void useCanvasStore.getState().navigateToColumn(i)

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
      <div className="flex items-center gap-1 bg-background/90 backdrop-blur-md border border-border rounded-lg px-3 py-1.5 shadow-lg">
        <button
          className={`text-xs transition-colors ${currentColumnIndex === 0 ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}
          aria-label="Navigate to root"
          onClick={() => navigateTo(0)}
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
              onClick={() => navigateTo(i)}
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
