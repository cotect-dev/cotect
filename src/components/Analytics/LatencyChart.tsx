import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useUsageStore } from '@/store/usage'

export default function LatencyChart() {
  const rows = useUsageStore((s) => s.latencyByModel) ?? []
  const data = rows.map((r) => ({
    model: r.bucket.replace('model:', ''),
    p50: r.p50_total_ms ?? 0,
  }))

  return (
    <div className="flex flex-col gap-2 p-4 rounded-lg border border-border bg-card">
      <h3 className="text-xs font-semibold">Latency by model (p50 total ms)</h3>
      <div style={{ width: '100%', height: 200 }}>
        <ResponsiveContainer>
          <BarChart data={data}>
            <XAxis dataKey="model" stroke="var(--color-muted-foreground)" fontSize={10} />
            <YAxis stroke="var(--color-muted-foreground)" fontSize={10} />
            <Tooltip />
            <Bar dataKey="p50" fill="#9ec0ff" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
