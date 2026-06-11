import { useMemo, useState } from 'react'
import { useHealthStore } from '@/store/health'
import { ArrowUp, ArrowDown } from 'lucide-react'
import RelativeTime from '@/components/RelativeTime'
import { Section, FileLink } from './shared'

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
  const [open, setOpen] = useState(false)

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
    <Section
      title="All files"
      right={
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
        >
          {open ? 'Hide' : `Show all ${sorted.length} files`}
        </button>
      }
    >
      {open && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className={`select-none cursor-pointer px-3 py-2 font-medium text-muted-foreground transition-colors hover:text-foreground ${
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
                  className={`border-b border-border/50 transition-colors hover:bg-muted/30 ${
                    row.isTest ? 'opacity-50' : ''
                  }`}
                >
                  <td className="px-3 py-1.5">
                    <FileLink path={row.path} label={row.path} />
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{row.layer}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{row.lineCount || '–'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{row.inDegree}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{row.outDegree}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{row.longestChainDepth}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{row.commitCount || '–'}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {row.lastModified > 0 ? <RelativeTime timestamp={row.lastModified} /> : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}
