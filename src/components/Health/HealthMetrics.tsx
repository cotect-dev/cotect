import { useMemo } from 'react'
import { useHealthStore } from '@/store/health'
import { ArrowUp, ArrowDown } from 'lucide-react'
import RelativeTime from '@/components/RelativeTime'
import { navigateToFile } from './navigateToFile'

interface Row {
  path: string
  layer: string
  lineCount: number
  inDegree: number
  outDegree: number
  longestChainDepth: number
  commitCount: number
  lastModified: number
  isTest: boolean
}

const COLUMNS: { key: keyof Row; label: string; align?: 'right' }[] = [
  { key: 'path', label: 'File' },
  { key: 'layer', label: 'Layer' },
  { key: 'lineCount', label: 'Lines', align: 'right' },
  { key: 'inDegree', label: 'In', align: 'right' },
  { key: 'outDegree', label: 'Out', align: 'right' },
  { key: 'longestChainDepth', label: 'Depth', align: 'right' },
  { key: 'commitCount', label: 'Churn', align: 'right' },
  { key: 'lastModified', label: 'Last Modified' },
]

export default function HealthMetrics() {
  const metrics = useHealthStore((s) => s.metrics)
  const churn = useHealthStore((s) => s.churn)
  const sortKey = useHealthStore((s) => s.metricsSortKey)
  const sortDir = useHealthStore((s) => s.metricsSortDir)
  const setSort = useHealthStore((s) => s.setMetricsSort)

  const rows = useMemo(() => {
    const churnMap = new Map(churn.map((c) => [c.path, c]))
    return metrics.map((m): Row => {
      const c = churnMap.get(m.path)
      return {
        ...m,
        commitCount: c?.commitCount ?? 0,
        lastModified: c?.lastModified ?? 0,
      }
    })
  }, [metrics, churn])

  const sorted = useMemo(() => {
    const key = sortKey as keyof Row
    return [...rows].sort((a, b) => {
      const av = a[key]
      const bv = b[key]
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av
      }
      return 0
    })
  }, [rows, sortKey, sortDir])

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSort(key, sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSort(key, key === 'path' || key === 'layer' ? 'asc' : 'desc')
    }
  }

  return (
    <div className="p-6 overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                className={`py-2 px-3 font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none ${
                  col.align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {sortKey === col.key &&
                    (sortDir === 'asc' ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    ))}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.path}
              className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${
                row.isTest ? 'opacity-50' : ''
              }`}
            >
              <td className="py-1.5 px-3">
                <button
                  type="button"
                  onClick={() => navigateToFile(row.path)}
                  className="font-mono text-foreground/80 hover:text-primary cursor-pointer text-left"
                  title={row.path}
                >
                  {row.path}
                </button>
              </td>
              <td className="py-1.5 px-3 text-muted-foreground">{row.layer}</td>
              <td className="py-1.5 px-3 text-right tabular-nums">{row.lineCount || '—'}</td>
              <td className="py-1.5 px-3 text-right tabular-nums">{row.inDegree}</td>
              <td className="py-1.5 px-3 text-right tabular-nums">{row.outDegree}</td>
              <td className="py-1.5 px-3 text-right tabular-nums">{row.longestChainDepth}</td>
              <td className="py-1.5 px-3 text-right tabular-nums">{row.commitCount || '—'}</td>
              <td className="py-1.5 px-3 text-muted-foreground">
                {row.lastModified > 0 ? <RelativeTime timestamp={row.lastModified} /> : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
