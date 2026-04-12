import { useState, useCallback, useEffect, useRef } from 'react'
import { useSettingsStore } from '@/store/settings'
import type { ProviderConfig } from '@/services/agent'
import { Button } from '@/components/ui/button'

const INPUT_CLASS =
  'h-7 px-2 text-xs rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary'
const MONO_INPUT_CLASS = `${INPUT_CLASS} font-mono`

function ProviderForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: ProviderConfig
  onSave: (config: ProviderConfig) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [endpoint, setEndpoint] = useState(initial?.endpoint ?? 'http://localhost:11434/v1')
  const [apiKey, setApiKey] = useState(initial?.api_key ?? '')
  const [model, setModel] = useState(initial?.model ?? '')

  const stableId = useRef(initial?.id ?? crypto.randomUUID())
  const testProvider = useSettingsStore((s) => s.testProvider)
  const testResult = useSettingsStore((s) => s.testResult)
  const testing = useSettingsStore((s) => s.testing)
  const clearTestResult = useSettingsStore((s) => s.clearTestResult)

  useEffect(() => {
    return () => clearTestResult()
  }, [clearTestResult])

  const handleTest = useCallback(() => {
    void testProvider({
      id: stableId.current,
      name: name || 'Test',
      endpoint,
      api_key: apiKey || undefined,
      model: model || '',
    })
  }, [name, endpoint, apiKey, model, testProvider])

  const handleSave = useCallback(() => {
    onSave({
      id: stableId.current,
      name: name || 'Provider',
      endpoint,
      api_key: apiKey || undefined,
      model,
    })
  }, [name, endpoint, apiKey, model, onSave])

  return (
    <div className="flex flex-col gap-2 p-2 rounded-lg border border-border bg-card">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="provider-name" className="text-[10px] text-muted-foreground font-medium">Name</label>
        <input
          id="provider-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Provider"
          className={INPUT_CLASS}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="provider-endpoint" className="text-[10px] text-muted-foreground font-medium">Endpoint</label>
        <input
          id="provider-endpoint"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder="http://localhost:11434/v1"
          className={MONO_INPUT_CLASS}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="provider-api-key" className="text-[10px] text-muted-foreground font-medium">API Key (optional)</label>
        <input
          id="provider-api-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          className={MONO_INPUT_CLASS}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="provider-model" className="text-[10px] text-muted-foreground font-medium">Model</label>
        <div className="flex gap-1">
          <input
            id="provider-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g., gpt-4o, llama3.1"
            className={`flex-1 ${MONO_INPUT_CLASS}`}
          />
        </div>
      </div>

      {testResult && (
        <div className={`text-[10px] rounded px-2 py-1 ${testResult.error ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
          {testResult.error
            ? `Connection failed: ${testResult.error}`
            : `Connected. ${testResult.models.length} model(s) available.`}
          {!testResult.error && testResult.models.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {testResult.models.slice(0, 10).map((m) => (
                <button
                  key={m}
                  onClick={() => setModel(m)}
                  className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                    model === m
                      ? 'bg-green-500/30 text-green-300'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {m}
                </button>
              ))}
              {testResult.models.length > 10 && (
                <span className="text-muted-foreground/40">+{testResult.models.length - 10} more</span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-1 justify-end">
        <Button size="sm" variant="ghost" onClick={onCancel} className="h-7 text-xs">
          Cancel
        </Button>
        <Button size="sm" variant="secondary" onClick={handleTest} disabled={testing || !endpoint} className="h-7 text-xs">
          {testing ? 'Testing...' : 'Test'}
        </Button>
        <Button size="sm" onClick={handleSave} disabled={!name || !endpoint || !model} className="h-7 text-xs">
          Save
        </Button>
      </div>
    </div>
  )
}

function ProviderCard({ provider, isActive }: { provider: ProviderConfig; isActive: boolean }) {
  const [editing, setEditing] = useState(false)
  const setActiveProvider = useSettingsStore((s) => s.setActiveProvider)
  const updateProvider = useSettingsStore((s) => s.updateProvider)
  const removeProvider = useSettingsStore((s) => s.removeProvider)

  if (editing) {
    return (
      <ProviderForm
        initial={provider}
        onSave={(updated) => {
          void updateProvider(provider.id, updated)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div
      className={`rounded-lg border p-2.5 flex flex-col gap-1 transition-colors ${
        isActive ? 'border-primary bg-primary/5' : 'border-border bg-card'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-foreground">{provider.name}</span>
          {isActive && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-primary/20 text-primary font-medium">active</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!isActive && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setActiveProvider(provider.id)}
              className="h-6 px-2 text-[10px]"
            >
              Activate
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditing(true)}
            className="h-6 px-2 text-[10px]"
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => removeProvider(provider.id)}
            className="h-6 px-2 text-[10px] text-red-400 hover:text-red-300"
          >
            Remove
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
        <span className="truncate max-w-[200px]">{provider.endpoint}</span>
        <span className="text-muted-foreground/40">|</span>
        <span>{provider.model || 'no model'}</span>
      </div>
    </div>
  )
}

export default function Settings() {
  const config = useSettingsStore((s) => s.config)
  const loading = useSettingsStore((s) => s.loading)
  const error = useSettingsStore((s) => s.error)
  const loadConfig = useSettingsStore((s) => s.loadConfig)
  const addProvider = useSettingsStore((s) => s.addProvider)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  if (loading || !config) {
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-xs text-muted-foreground">
          <span className="text-red-400">Failed to load configuration: {error}</span>
          <Button size="sm" variant="secondary" onClick={() => loadConfig()} className="h-7 text-xs">
            Retry
          </Button>
        </div>
      )
    }
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        Loading configuration...
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full gap-3 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-foreground">LLM Providers</h3>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setAdding(true)}
          disabled={adding}
          className="h-6 px-2 text-[10px]"
        >
          Add Provider
        </Button>
      </div>

      {adding && (
        <ProviderForm
          onSave={(provider) => {
            void addProvider(provider)
            setAdding(false)
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      <div className="flex flex-col gap-1.5">
        {config.providers.length === 0 && !adding && (
          <div className="text-xs text-muted-foreground text-center py-4">
            No providers configured. Add one to get started.
          </div>
        )}
        {config.providers.map((p) => (
          <ProviderCard
            key={p.id}
            provider={p}
            isActive={p.id === config.active_provider_id}
          />
        ))}
      </div>

      <div className="text-[10px] text-muted-foreground/50 mt-auto pt-2 border-t border-border">
        Configure OpenAI-compatible LLM providers. The active provider is used for all agent tasks.
        Supports Ollama, OpenAI, Anthropic (via proxy), and any OpenAI-compatible endpoint.
      </div>
    </div>
  )
}
