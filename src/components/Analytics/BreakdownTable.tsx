import { useUsageStore } from '@/store/usage'

export default function BreakdownTable() {
  const rows = useUsageStore((s) => s.breakdown) ?? []
  return (
    <div className="flex flex-col gap-2 p-4 rounded-lg border border-border bg-card">
      <h3 className="text-xs font-semibold">Breakdown by provider × day</h3>
      <div className="border border-border rounded overflow-x-auto">
        <div className="min-w-[500px]">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] bg-muted/40 px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            <div>Bucket</div>
            <div>Tasks</div>
            <div>Prompt tok</div>
            <div>Completion tok</div>
            <div>p50 total</div>
          </div>
          {rows.map((r) => (
            <div
              key={r.bucket}
              className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] px-3 py-1.5 border-t border-border text-[11px] font-mono"
            >
              <div className="truncate">{r.bucket}</div>
              <div>{r.tasks}</div>
              <div>{r.prompt_tokens.toLocaleString()}</div>
              <div>{r.completion_tokens.toLocaleString()}</div>
              <div>{r.p50_total_ms != null ? `${r.p50_total_ms}ms` : '—'}</div>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
              No data in this range.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
