import { ChevronRight, Home } from 'lucide-react'
import { useBrowserStore } from '@/store'

export default function Breadcrumbs() {
  const { breadcrumbs, navigateToBreadcrumb, currentPath, loading } = useBrowserStore()

  if (breadcrumbs.length === 0 && !currentPath) return null

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
      <div className="flex items-center gap-1 bg-background/90 backdrop-blur-md border border-border rounded-lg px-3 py-1.5 shadow-lg">
        <button
          className="text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => {
            const { rootPath } = useBrowserStore.getState()
            if (rootPath) useBrowserStore.getState().navigateTo(rootPath, 'directory')
          }}
        >
          <Home className="h-3.5 w-3.5" />
        </button>

        {breadcrumbs.map((crumb, i) => (
          <div key={crumb.path} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            <button
              className={`text-xs transition-colors ${
                i === breadcrumbs.length - 1
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => navigateToBreadcrumb(i)}
              disabled={i === breadcrumbs.length - 1}
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
