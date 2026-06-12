import { memo, useCallback, useMemo } from 'react'
import { ChevronRight, ChevronLeft, Home } from 'lucide-react'
import { useCanvasStore } from '@/store'
import { basename } from '@/lib/repoPath'

export default memo(function Breadcrumbs() {
  const depthChain = useCanvasStore((s) => s.depthChain)
  const currentColumnIndex = useCanvasStore((s) => s.currentColumnIndex)
  const fileHistory = useCanvasStore((s) => s.fileHistory)

  const crumbs = useMemo(
    () =>
      depthChain.map((path, i) => ({
        path,
        label: basename(path),
        isCurrent: i === currentColumnIndex,
      })),
    [depthChain, currentColumnIndex],
  )

  const navigateTo = (i: number) => void useCanvasStore.getState().navigateToColumn(i)
  const navigateBack = useCallback(() => void useCanvasStore.getState().navigateBack(), [])

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
      <div className="flex items-center gap-1 bg-background/90 backdrop-blur-md border border-border rounded-lg px-3 py-1.5 shadow-lg">
        {fileHistory.length > 0 && (
          <button
            className="text-xs text-muted-foreground hover:text-foreground transition-colors mr-1"
            aria-label="Navigate back (Q)"
            title={`Back to ${basename(fileHistory[fileHistory.length - 1])}`}
            onClick={navigateBack}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        )}

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
