import { useMemo } from 'react'
import { useConsoleStore, type LogLevel } from '@/store/console'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'
import { useScrollToBottom } from '@/hooks/useScrollToBottom'

const levelColors: Record<LogLevel, string> = {
  info: 'text-blue-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
  debug: 'text-muted-foreground',
}

const levelLabels: Record<LogLevel, string> = {
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
  debug: 'DBG',
}

const filterOptions: { value: LogLevel | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
]

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

export default function Console() {
  const entries = useConsoleStore((s) => s.entries)
  const filter = useConsoleStore((s) => s.filter)
  const clear = useConsoleStore((s) => s.clear)
  const setFilter = useConsoleStore((s) => s.setFilter)

  const filtered = useMemo(
    () => filter ? entries.filter((e) => e.level === filter) : entries,
    [entries, filter],
  )

  const bottomRef = useScrollToBottom(filtered.length)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border/50 shrink-0">
        {filterOptions.map((opt) => (
          <button
            key={opt.label}
            onClick={() => setFilter(opt.value)}
            className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
              filter === opt.value
                ? 'bg-primary/20 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="xs"
          onClick={clear}
          className="text-muted-foreground"
          disabled={entries.length === 0}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto font-mono text-[11px] leading-[18px]">
        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
            No output
          </div>
        )}
        {filtered.map((entry) => (
          <div
            key={entry.id}
            className="flex gap-2 px-2 py-px hover:bg-muted/30 border-b border-border/10"
          >
            <span className="text-muted-foreground/60 shrink-0 select-none">
              {formatTime(entry.timestamp)}
            </span>
            <span className={`shrink-0 w-7 select-none ${levelColors[entry.level]}`}>
              {levelLabels[entry.level]}
            </span>
            <span className="whitespace-pre-wrap break-all">{entry.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
