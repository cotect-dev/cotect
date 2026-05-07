import { useKvField } from '@/hooks/useKvField'

const STYLES = ['default', 'terse', 'detailed', 'cot', 'answer_first'] as const
type SystemStyle = typeof STYLES[number]

const TOOLS = ['read', 'edit', 'run', 'search', 'list_directory', 'follow_up'] as const

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-x-4 items-center py-1.5">
      <div className="flex flex-col">
        <span className="text-[11px] font-medium text-foreground">{label}</span>
        {hint && <span className="text-[10px] text-muted-foreground/70">{hint}</span>}
      </div>
      <div className="flex items-center">{children}</div>
    </div>
  )
}

function Subhead({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium pt-3 pb-1">{children}</div>
}

export default function AgentSection() {
  const [systemStyle, setSystemStyle]   = useKvField<SystemStyle>('agent.system_style', 'default')
  const [maxTurns, setMaxTurns]         = useKvField<number>('agent.max_turns', 25)
  const [timeoutSecs, setTimeoutSecs]   = useKvField<number>('agent.timeout_secs', 600)
  const [disableThinking, setDisableThinking] = useKvField<boolean>('agent.disable_thinking', false)
  const [temperature, setTemperature]   = useKvField<number>('agent.temperature', 0)
  const [toolAllow, setToolAllow]       = useKvField<string[]>('agent.tool_allowlist', [...TOOLS])
  const [autoCont, setAutoCont]         = useKvField<boolean>('agent.auto_continue_on_stall', true)
  const [transcriptDir, setTranscriptDir] = useKvField<string>('agent.transcript_dir', '')
  const [systemPrefix, setSystemPrefix] = useKvField<string>('agent.system_prefix', '')

  const toggleTool = (t: string) => {
    setToolAllow(toolAllow.includes(t) ? toolAllow.filter((x) => x !== t) : [...toolAllow, t])
  }

  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-sm font-semibold text-foreground mb-2">Agent</h2>

      <Subhead>Behavior</Subhead>
      <Row label="System prompt style">
        <select className="h-7 px-2 text-xs rounded border border-border bg-background"
          value={systemStyle} onChange={(e) => setSystemStyle(e.target.value as SystemStyle)}>
          {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Row>
      <Row label="Max turns" hint="1–100">
        <input type="number" min={1} max={100}
          className="h-7 w-24 px-2 text-xs rounded border border-border bg-background"
          value={maxTurns} onChange={(e) => {
            const n = Number(e.target.value)
            if (n >= 1 && n <= 100) setMaxTurns(n)
          }} />
      </Row>
      <Row label="Per-task timeout" hint="30–3600 seconds">
        <input type="number" min={30} max={3600}
          className="h-7 w-24 px-2 text-xs rounded border border-border bg-background"
          value={timeoutSecs} onChange={(e) => {
            const n = Number(e.target.value)
            if (n >= 30 && n <= 3600) setTimeoutSecs(n)
          }} />
        <span className="ml-2 text-[10px] text-muted-foreground">seconds</span>
      </Row>
      <Row label="Disable thinking" hint="Strip reasoning blocks before model call">
        <input type="checkbox" checked={disableThinking} onChange={(e) => setDisableThinking(e.target.checked)} />
      </Row>
      <Row label="Temperature" hint="0–2 (default 0 for agentic work)">
        <input type="range" min={0} max={2} step={0.1} value={temperature}
          className="w-48"
          onChange={(e) => setTemperature(Number(e.target.value))} />
        <span className="ml-3 text-[11px] font-mono w-10 text-muted-foreground">{temperature.toFixed(1)}</span>
      </Row>

      <Subhead>Tool access</Subhead>
      <Row label="Allowed tools">
        <div className="flex flex-wrap gap-2">
          {TOOLS.map((t) => (
            <label key={t} className="flex items-center gap-1.5 text-[11px]">
              <input type="checkbox" checked={toolAllow.includes(t)} onChange={() => toggleTool(t)} />
              <span className="font-mono">{t}</span>
            </label>
          ))}
        </div>
      </Row>

      <Subhead>Stalls & limits</Subhead>
      <Row label="Auto-continue on stall" hint="Nudge model when reasoning stalls">
        <input type="checkbox" checked={autoCont} onChange={(e) => setAutoCont(e.target.checked)} />
      </Row>

      <Subhead>Logs</Subhead>
      <Row label="Transcript directory" hint="Empty = off">
        <input type="text"
          className="h-7 flex-1 px-2 text-xs rounded border border-border bg-background font-mono"
          placeholder="/path/to/transcripts"
          value={transcriptDir} onChange={(e) => setTranscriptDir(e.target.value)} />
      </Row>

      <Subhead>Custom prompt</Subhead>
      <Row label="System prefix" hint="Prepended to the role system prompt">
        <textarea
          className="px-2 py-1 text-xs rounded border border-border bg-background font-mono w-full min-h-[80px] resize-y"
          placeholder="(empty)"
          value={systemPrefix} onChange={(e) => setSystemPrefix(e.target.value)} />
      </Row>
    </div>
  )
}
