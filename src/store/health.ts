import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { createStoreWithHMR } from '@/lib/hmr'
import { useGraphStore } from '@/store/graph'
import { analyzeGraph, type Finding, type FileMetrics } from '@/services/structureAnalyzer'
import { computeChurn, computeHotspots, type FileChurn, type Hotspot } from '@/services/gitAnalysis'
import { computeFileSizes, type FileSizeInfo } from '@/lib/llmContext'
import type { GitLogEntry } from '@/store/git'

export type HealthScanState = 'idle' | 'analyzing' | 'ready' | 'error'

interface HealthState {
  scanState: HealthScanState
  errorMessage: string | null
  lastAnalyzedAt: number | null
  progress: string | null
  analyzedRoot: string | null

  findings: Finding[]
  metrics: FileMetrics[]

  churn: FileChurn[]
  hotspots: Hotspot[]
  fileSizes: FileSizeInfo[]

  metricsSortKey: string
  metricsSortDir: 'asc' | 'desc'
  analyze: (rootPath: string) => Promise<void>
  setMetricsSort: (key: string, dir: 'asc' | 'desc') => void
}

export const useHealthStore = createStoreWithHMR(import.meta.hot, 'health', () =>
  create<HealthState>((set) => ({
    scanState: 'idle',
    errorMessage: null,
    lastAnalyzedAt: null,
    progress: null,
    analyzedRoot: null,

    findings: [],
    metrics: [],

    churn: [],
    hotspots: [],
    fileSizes: [],

    metricsSortKey: 'path',
    metricsSortDir: 'asc',
    analyze: async (rootPath: string) => {
      const graphState = useGraphStore.getState()
      if (graphState.scanState !== 'ready') {
        set({ scanState: 'error', errorMessage: 'Graph scan not ready' })
        return
      }

      // Set before the work starts so a failed run doesn't auto-retry in a loop
      set({
        scanState: 'analyzing',
        errorMessage: null,
        progress: 'Collecting file data...',
        analyzedRoot: rootPath,
      })

      try {
        // Graceful degradation on failure — structural findings still available
        const gitLogPromise = invoke<GitLogEntry[]>('git_log', {
          repoPath: rootPath,
          limit: 500,
        }).catch(() => [] as GitLogEntry[])

        const files = graphState.allNodes.map((n) => n.id)
        const edges: [string, string][] = graphState.allEdges.map((e) => [e.source, e.target])
        const knownFiles = new Set(files)

        const lineCounts = new Map<string, number>()
        const charCounts = new Map<string, number>()
        for (const n of graphState.allNodes) {
          lineCounts.set(n.id, n.lineCount ?? 0)
          charCounts.set(n.id, n.charCount ?? 0)
        }

        set({ progress: 'Analyzing structure...' })
        const result = analyzeGraph(files, edges, {}, lineCounts)

        set({ progress: 'Fetching git history...' })
        const gitLog = await gitLogPromise

        set({ progress: 'Computing git metrics...' })
        const churn = computeChurn(gitLog, knownFiles)
        const hotspots = computeHotspots(churn, result.metrics)
        const fileSizes = computeFileSizes(result.metrics, charCounts)

        set({
          scanState: 'ready',
          progress: null,
          findings: result.findings,
          metrics: result.metrics,
          churn,
          hotspots,
          fileSizes,
          lastAnalyzedAt: Date.now(),
        })
      } catch (err) {
        set({
          scanState: 'error',
          progress: null,
          errorMessage: err instanceof Error ? err.message : String(err),
        })
      }
    },

    setMetricsSort: (key, dir) => set({ metricsSortKey: key, metricsSortDir: dir }),
  })),
)
