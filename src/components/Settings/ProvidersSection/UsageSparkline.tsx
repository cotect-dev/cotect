import { useEffect, useState } from 'react'
import { usageAggregate } from '@/services/db'
import { useViewStore } from '@/store/view'

interface DayBucket { day: string; tokens: number; tasks: number }

export default function UsageSparkline({ providerId }: { providerId: string }) {
  const [buckets, setBuckets] = useState<DayBucket[]>([])
  const setViewMode = useViewStore((s) => s.setViewMode)

  useEffect(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    void usageAggregate(
      { from_ts: sevenDaysAgo, to_ts: null, provider_id: providerId, model: null, role: null, limit: null },
      'Day',
    ).then((rows) => {
      setBuckets(rows.map((r) => ({
        day: r.bucket.replace('day:', ''),
        tokens: r.prompt_tokens + r.completion_tokens,
        tasks: r.tasks,
      })))
    })
  }, [providerId])

  if (buckets.length === 0) return null

  const max = Math.max(...buckets.map((b) => b.tokens), 1)
  const W = 220, H = 28
  const stepX = W / Math.max(buckets.length - 1, 1)
  const points = buckets.map((b, i) => `${i * stepX},${H - (b.tokens / max) * (H - 4) - 2}`).join(' ')
  const totalTokens = buckets.reduce((s, b) => s + b.tokens, 0)
  const totalTasks = buckets.reduce((s, b) => s + b.tasks, 0)

  return (
    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
      <div className="uppercase tracking-wider text-[10px]">Last 7 days</div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <polyline points={points} fill="none" stroke="currentColor" strokeOpacity="0.7" strokeWidth="1.5" />
      </svg>
      <div>{totalTokens.toLocaleString()} tokens · {totalTasks} tasks</div>
      <span className="flex-1" />
      <button onClick={() => setViewMode('analytics')} className="text-primary hover:underline">
        Open in Analytics →
      </button>
    </div>
  )
}
