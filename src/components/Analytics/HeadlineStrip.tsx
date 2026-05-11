import { useUsageStore } from '@/store/usage'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 border border-border rounded-lg bg-card flex-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{label}</span>
      <span className="text-xl font-semibold">{value}</span>
    </div>
  )
}

export default function HeadlineStrip() {
  const h = useUsageStore((s) => s.headline)
  if (!h) return null
  return (
    <div className="grid grid-cols-2 gap-3">
      <Stat label="Total tokens" value={h.tokens.toLocaleString()} />
      <Stat label="Tasks" value={h.tasks.toString()} />
      <Stat
        label="p50 first token"
        value={h.p50_first_token != null ? `${h.p50_first_token}ms` : '—'}
      />
      <Stat
        label="p50 total"
        value={h.p50_total != null ? `${(h.p50_total / 1000).toFixed(1)}s` : '—'}
      />
    </div>
  )
}
