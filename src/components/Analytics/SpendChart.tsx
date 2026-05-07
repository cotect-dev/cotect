import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useUsageStore } from '@/store/usage'

type Mode = 'provider' | 'role'

export default function SpendChart() {
  const [mode, setMode] = useState<Mode>('provider')
  const byProvider = useUsageStore((s) => s.spendByProvider) ?? []
  const byRole = useUsageStore((s) => s.spendByRole) ?? []
  const rows = mode === 'provider' ? byProvider : byRole
  const data = rows.map((r) => ({
    bucket: r.bucket.replace(/^(provider|role):/, ''),
    tokens: r.prompt_tokens + r.completion_tokens,
  }))

  return (
    <div className="flex flex-col gap-2 p-4 rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold">Token usage</h3>
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
          <BarChart data={data}>
            <XAxis dataKey="bucket" stroke="var(--color-muted-foreground)" fontSize={10} />
            <YAxis stroke="var(--color-muted-foreground)" fontSize={10} />
            <Tooltip />
            <Bar dataKey="tokens" fill="#9ec0ff" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
