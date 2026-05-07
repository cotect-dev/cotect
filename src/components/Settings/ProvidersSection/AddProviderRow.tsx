import { useState } from 'react'
import { probeProvider } from '@/services/agent'
import { useProvidersStore } from '@/store/providers'
import { Button } from '@/components/ui/button'

const INPUT = 'h-7 px-2 text-xs rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary'
const MONO = `${INPUT} font-mono`

export default function AddProviderRow() {
  const upsert = useProvidersStore((s) => s.upsert)
  const [endpoint, setEndpoint] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const onConnect = async () => {
    setBusy(true)
    setErr(null)
    try {
      const probed = await probeProvider({ endpoint, api_key: apiKey || null })
      const id = crypto.randomUUID()
      const label = `${probed.server_type} — ${endpoint}`
      await upsert({
        id, label,
        endpoint: probed.normalized_endpoint,
        api_key: apiKey || null,
        detected_json: JSON.stringify({
          server_type: probed.server_type,
          models: probed.models,
          capabilities: probed.capabilities,
          format_per_model: probed.format_per_model,
        }),
        health_json: JSON.stringify({
          state: 'Healthy',
          consecutive_failures: 0,
          last_ok_at_ms: Date.now(),
          p50_first_token_ms: null,
          last_error: null,
        }),
        position: 0,
      })
      setEndpoint('')
      setApiKey('')
    } catch (e) {
      setErr(typeof e === 'string' ? e : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-foreground min-w-[96px]">Add provider</span>
        <input
          className={`flex-1 ${MONO}`}
          placeholder="host:port  e.g. localhost:11434"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
        />
        <input
          className={`w-[180px] ${MONO}`}
          type="password"
          placeholder="API key (optional)"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <Button size="sm" onClick={onConnect} disabled={busy || !endpoint} className="h-7 text-xs">
          {busy ? 'Probing…' : 'Connect'}
        </Button>
      </div>
      {err && (
        <div className="text-[11px] rounded px-2 py-1.5 bg-red-500/10 text-red-400 whitespace-pre-wrap">
          {err}
        </div>
      )}
    </div>
  )
}
