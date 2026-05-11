import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts'
import { useUsageStore } from '@/store/usage'

/* ── custom tooltip ─────────────────────────────────────── */

interface TipPayload {
  value: number
  payload: { date: string; tokens: number }
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: TipPayload[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  // Hide tooltip for padding bars
  if (!label || !label.trim()) return null
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 shadow-md">
      <p className="text-[11px] font-medium text-popover-foreground">{label}</p>
      <p className="text-[11px] text-muted-foreground tabular-nums">
        {entry.value.toLocaleString()} tokens
      </p>
    </div>
  )
}

/* ── format bucket string into a short date label ───────── */

function formatDate(bucket: string): string {
  // bucket is e.g. "day:2026-05-11" or just "2026-05-11"
  const raw = bucket.replace(/^day:/, '')
  const d = new Date(raw)
  if (isNaN(d.getTime())) return raw
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/* ── chart ──────────────────────────────────────────────── */

export default function SpendChart() {
  const byDay = useUsageStore((s) => s.spendByDay) ?? []

  const real = byDay.map((r) => ({
    date: formatDate(r.bucket),
    tokens: r.prompt_tokens + r.completion_tokens,
  }))
  // Pad with empty bars so a single entry doesn't stretch full width
  const pad = Math.max(0, 5 - real.length)
  const data = [
    ...real,
    ...Array.from({ length: pad }, (_, i) => ({ date: ' '.repeat(i + 1), tokens: 0 })),
  ]

  return (
    <div className="flex flex-col gap-2 p-4 rounded-lg border border-border bg-card h-full">
      <h3 className="text-xs font-semibold">Token usage</h3>

      <div className="flex-1 min-h-0" style={{ width: '100%', minHeight: 180 }}>
        <ResponsiveContainer>
          <BarChart data={data} barCategoryGap="25%">
            <CartesianGrid
              vertical={false}
              stroke="var(--color-border)"
              strokeDasharray="3 3"
            />
            <XAxis
              dataKey="date"
              tick={{ fill: 'var(--color-muted-foreground)', fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: 'var(--color-border)' }}
            />
            <YAxis
              tick={{ fill: 'var(--color-muted-foreground)', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ fill: 'var(--color-muted)', opacity: 0.15 }}
            />
            <Bar
              dataKey="tokens"
              fill="var(--color-chart-1)"
              maxBarSize={48}
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
