import { useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useUsageStore } from '@/store/usage'

type Mode = 'provider' | 'role'

interface DayPoint { day: string; [series: string]: number | string }

// @ts-expect-error — dead code in v1; kept for future stacked-time-series swap-in
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildSeries(rows: { bucket: string; prompt_tokens: number; completion_tokens: number }[]): { data: DayPoint[]; keys: string[] } {
  // bucket format: "{provider_or_role}|{YYYY-MM-DD}"
  const dayMap = new Map<string, DayPoint>()
  const keys = new Set<string>()
  for (const row of rows) {
    const [series, day] = row.bucket.split('|')
    if (!day) continue
    keys.add(series)
    const point = dayMap.get(day) ?? { day }
    point[series] = row.prompt_tokens + row.completion_tokens
    dayMap.set(day, point)
  }
  const data = [...dayMap.values()].sort((a, b) => (a.day as string).localeCompare(b.day as string))
  return { data, keys: [...keys] }
}

const COLORS = ['#9ec0ff', '#7ec77e', '#f0c674', '#e08080', '#c39bd3', '#85c1e9']

export default function SpendChart() {
  const [mode, setMode] = useState<Mode>('provider')
  const provider = useUsageStore((s) => s.spendByProvider) ?? []
  // Note: spendByProvider here is grouped by Provider (no day axis). For a stacked time series we re-query under ProviderDay/RoleDay; the store already loads ProviderDay into `breakdown`. For role we'd need a parallel RoleDay query — keep v1 simple and toggle by re-aggregating provider buckets into a single grouped chart for now.
   
  const _roleStub = useUsageStore((s) => s.spendByRole) ?? []
  const rows = mode === 'provider' ? provider : _roleStub
  const data = rows.map((r) => ({
    bucket: r.bucket.replace(/^(provider|role):/, ''),
    tokens: r.prompt_tokens + r.completion_tokens,
  }))

  return (
    <div className="flex flex-col gap-2 p-4 rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold">Spend over time</h3>
        <div className="flex rounded border border-border overflow-hidden">
          {(['provider', 'role'] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-2 py-0.5 text-[10px] ${mode === m ? 'bg-primary/15 text-primary' : 'text-muted-foreground'}`}>
              by {m}
            </button>
          ))}
        </div>
      </div>
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <AreaChart data={data}>
            <XAxis dataKey="bucket" stroke="var(--color-muted-foreground)" fontSize={10} />
            <YAxis stroke="var(--color-muted-foreground)" fontSize={10} />
            <Tooltip />
            <Legend />
            <Area type="monotone" dataKey="tokens" stroke={COLORS[0]} fill={COLORS[0]} fillOpacity={0.3} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
