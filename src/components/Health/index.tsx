import { useEffect } from 'react'
import { useHealthStore } from '@/store/health'
import { useGraphStore } from '@/store/graph'
import { useBrowserStore } from '@/store'
import RelativeTime from '@/components/RelativeTime'
import { RefreshCw, Loader2 } from 'lucide-react'
import HealthSummary from './HealthSummary'
import HealthFindings from './HealthFindings'
import HealthMetrics from './HealthMetrics'
import type { HealthTab } from '@/store/health'

const TABS: { id: HealthTab; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'findings', label: 'Findings' },
  { id: 'metrics', label: 'Metrics' },
]

export default function Health() {
  const scanState = useHealthStore((s) => s.scanState)
  const activeTab = useHealthStore((s) => s.activeTab)
  const setActiveTab = useHealthStore((s) => s.setActiveTab)
  const analyze = useHealthStore((s) => s.analyze)
  const lastAnalyzedAt = useHealthStore((s) => s.lastAnalyzedAt)
  const progress = useHealthStore((s) => s.progress)
  const errorMessage = useHealthStore((s) => s.errorMessage)
  const graphReady = useGraphStore((s) => s.scanState === 'ready')
  const rootPath = useBrowserStore((s) => s.rootPath)

  useEffect(() => {
    if (scanState === 'idle' && graphReady && rootPath) {
      void analyze(rootPath)
    }
  }, [scanState, graphReady, rootPath, analyze])

  const handleRefresh = () => {
    if (rootPath && scanState !== 'analyzing') {
      void analyze(rootPath)
    }
  }

  const findingCount = useHealthStore((s) => s.findings.length)

  return (
    <div className="flex flex-col w-full h-full overflow-hidden bg-background">
      <div className="shrink-0 flex items-center gap-4 px-6 py-3 border-b border-border">
        <h1 className="text-sm font-semibold text-foreground">Codebase Health</h1>

        <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1 text-xs rounded-sm cursor-pointer transition-colors ${
                activeTab === tab.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
              {tab.id === 'findings' && findingCount > 0 && (
                <span className="ml-1.5 text-[10px] text-muted-foreground">{findingCount}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {lastAnalyzedAt && (
          <span className="text-[11px] text-muted-foreground">
            Updated <RelativeTime timestamp={Math.floor(lastAnalyzedAt / 1000)} />
          </span>
        )}

        <button
          type="button"
          onClick={handleRefresh}
          disabled={scanState === 'analyzing'}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-50"
          title="Re-analyze"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${scanState === 'analyzing' ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {scanState === 'analyzing' && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm">{progress ?? 'Analyzing...'}</span>
          </div>
        )}

        {scanState === 'error' && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <span className="text-sm text-red-400">{errorMessage ?? 'Analysis failed'}</span>
            <button
              type="button"
              onClick={handleRefresh}
              className="text-xs text-primary hover:underline cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {scanState === 'idle' && !graphReady && (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Waiting for graph scan to complete...
          </div>
        )}

        {scanState === 'idle' && graphReady && !rootPath && (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            No project open
          </div>
        )}

        {scanState === 'ready' && (
          <>
            {activeTab === 'summary' && <HealthSummary />}
            {activeTab === 'findings' && <HealthFindings />}
            {activeTab === 'metrics' && <HealthMetrics />}
          </>
        )}
      </div>
    </div>
  )
}
