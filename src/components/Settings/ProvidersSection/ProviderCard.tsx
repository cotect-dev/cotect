import { useState } from 'react'
import type { Provider, ActiveAssignment } from '@/services/db'
import { useProvidersStore } from '@/store/providers'
import { probeProvider } from '@/services/agent'
import { Button } from '@/components/ui/button'
import { readDetected, readHealth } from './types'
import ModelTable from './ModelTable'
import RoleAssignment from './RoleAssignment'
import UsageSparkline from './UsageSparkline'

const INPUT =
  'h-7 px-2 text-xs rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary'

function relTime(ms: number | null): string {
  if (!ms) return '—'
  const diff = (Date.now() - ms) / 1000
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

export default function ProviderCard({
  provider,
  assignment,
}: {
  provider: Provider
  assignment: ActiveAssignment | null
}) {
  const upsert = useProvidersStore((s) => s.upsert)
  const remove = useProvidersStore((s) => s.remove)
  const [reprobing, setReprobing] = useState(false)

  const detected = readDetected(provider)
  const health = readHealth(provider)
  const isDefault = assignment?.default_provider_id === provider.id
  const dotColor =
    health.state === 'Healthy'
      ? 'bg-green-500 shadow-green-500/50'
      : health.state === 'Degraded'
        ? 'bg-yellow-500 shadow-yellow-500/50'
        : 'bg-red-500   shadow-red-500/50'

  const onLabelChange = (label: string) => {
    void upsert({ ...provider, label })
  }
  const onEndpointChange = (endpoint: string) => {
    void upsert({ ...provider, endpoint })
  }
  const onApiKeyChange = (api_key: string) => {
    void upsert({ ...provider, api_key: api_key || null })
  }
  const onReprobe = async () => {
    setReprobing(true)
    try {
      const probed = await probeProvider({ endpoint: provider.endpoint, api_key: provider.api_key })
      await upsert({
        ...provider,
        detected_json: JSON.stringify(probed),
        health_json: JSON.stringify({
          state: 'Healthy',
          consecutive_failures: 0,
          last_ok_at_ms: Date.now(),
          p50_first_token_ms: health.p50_first_token_ms,
          last_error: null,
        }),
      })
    } catch (e) {
      await upsert({
        ...provider,
        health_json: JSON.stringify({
          state: 'Unhealthy',
          consecutive_failures: 3,
          last_ok_at_ms: health.last_ok_at_ms,
          p50_first_token_ms: health.p50_first_token_ms,
          last_error: String(e),
        }),
      })
    } finally {
      setReprobing(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-block w-2.5 h-2.5 rounded-full shadow-md flex-shrink-0 ${dotColor}`}
        />
        <input
          className="text-sm font-semibold bg-transparent border-none outline-none focus:ring-1 focus:ring-primary rounded px-1 min-w-0 flex-1"
          value={provider.label}
          onChange={(e) => onLabelChange(e.target.value)}
        />
        {isDefault && (
          <span className="px-1.5 py-0.5 rounded text-[9px] bg-primary/20 text-primary font-medium flex-shrink-0">
            DEFAULT
          </span>
        )}
        <span className="px-1.5 py-0.5 rounded text-[9px] bg-muted text-muted-foreground flex-shrink-0">
          {health.state === 'Healthy' && `last ok ${relTime(health.last_ok_at_ms)}`}
          {health.state !== 'Healthy' &&
            `${health.state.toLowerCase()}${health.last_error ? ` · ${health.last_error.slice(0, 40)}` : ''}`}
          {health.p50_first_token_ms != null && ` · p50 ${health.p50_first_token_ms}ms`}
        </span>
        <span className="flex-1" />
        <div className="flex gap-1 flex-shrink-0">
          <Button
            size="sm"
            variant="secondary"
            onClick={onReprobe}
            disabled={reprobing}
            className="h-6 px-2 text-[10px]"
          >
            {reprobing ? 'Probing…' : 'Reprobe'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void remove(provider.id)}
            className="h-6 px-2 text-[10px] text-red-400 hover:text-red-300"
          >
            Remove
          </Button>
        </div>
      </div>

      {health.state === 'Unhealthy' && health.last_error && (
        <div className="text-[11px] rounded px-2 py-1.5 bg-red-500/10 text-red-400 border border-red-500/25 whitespace-pre-wrap">
          {health.last_error}
        </div>
      )}

      <div className="grid grid-cols-[80px_1fr] gap-y-1.5 gap-x-3 text-[11px]">
        <div className="text-muted-foreground">Endpoint</div>
        <input
          className={`${INPUT} font-mono min-w-0`}
          value={provider.endpoint}
          onChange={(e) => onEndpointChange(e.target.value)}
        />

        <div className="text-muted-foreground">API key</div>
        <input
          className={`${INPUT} font-mono min-w-0`}
          type="password"
          placeholder="(none)"
          value={provider.api_key ?? ''}
          onChange={(e) => onApiKeyChange(e.target.value)}
        />

        {detected && (
          <>
            <div className="text-muted-foreground">Detected</div>
            <div className="flex flex-wrap gap-1.5">
              <span className="px-2 py-0.5 rounded text-[10px] bg-muted">
                {detected.server_type}
              </span>
              {detected.capabilities.map((c) => (
                <span key={c} className="px-2 py-0.5 rounded text-[10px] bg-muted">
                  {c}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {detected && detected.models.length > 0 && (
        <ModelTable provider={provider} detected={detected} assignment={assignment} />
      )}

      <RoleAssignment provider={provider} detected={detected} assignment={assignment} />

      <UsageSparkline providerId={provider.id} />
    </div>
  )
}
