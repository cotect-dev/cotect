import { useHealthStore } from '@/store/health'
import type { Hotspot } from '@/services/gitAnalysis'
import { Section, FileLink } from './shared'

const TOP_N = 12

function why(h: Hotspot): string {
  const parts: string[] = []
  if (h.churnScore >= 0.5) parts.push('high churn')
  parts.push(`${h.commitCount} commits`)
  parts.push(`${h.lineCount} lines`)
  if (h.inDegree > 0) parts.push(`${h.inDegree} importers`)
  return parts.join(' · ')
}

export default function ReviewPriority() {
  const hotspots = useHealthStore((s) => s.hotspots)
  if (hotspots.length === 0) return null

  const top = hotspots.slice(0, TOP_N)
  const max = top[0].hotspotScore || 1

  return (
    <Section
      title="Review priority"
      subtitle="Files combining frequent change with size, the ones most likely to repay careful review."
      tooltip="Risk = recent commit churn × file size, each normalized to the busiest/largest file. History-based churn×size hotspots are the best-supported review-priority signal."
    >
      <div className="divide-y divide-border/50 rounded-lg border border-border bg-card">
        {top.map((h) => (
          <div key={h.path} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <div className="w-full min-w-0 sm:w-44 sm:shrink-0">
              <FileLink path={h.path} className="text-xs" />
            </div>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-amber-400/80"
                style={{ width: `${Math.round((h.hotspotScore / max) * 100)}%` }}
              />
            </div>
            <span
              className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
              title={why(h)}
            >
              {why(h)}
            </span>
          </div>
        ))}
      </div>
    </Section>
  )
}
