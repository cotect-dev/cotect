import { useUsageStore, presetToRange, type RangePreset } from '@/store/usage'

const PRESETS: RangePreset[] = ['today', '7d', '30d', 'all']
const LABELS: Record<RangePreset, string> = {
  today: 'Today',
  '7d': '7 days',
  '30d': '30 days',
  all: 'All time',
  custom: 'Custom',
}

export default function DateRangePicker() {
  const range = useUsageStore((s) => s.range)
  const setRange = useUsageStore((s) => s.setRange)

  return (
    <div className="flex items-center gap-2">
      <div className="flex rounded border border-border overflow-hidden">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => setRange(presetToRange(p))}
            className={`px-3 py-1 text-[11px] transition-colors ${
              range.preset === p
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {LABELS[p]}
          </button>
        ))}
      </div>
      {range.preset === 'custom' && (
        <>
          <input
            type="date"
            className="h-7 px-2 text-xs rounded border border-border bg-background"
            value={range.from ? new Date(range.from).toISOString().slice(0, 10) : ''}
            onChange={(e) =>
              setRange({
                ...range,
                from: e.target.value ? new Date(e.target.value).getTime() : null,
              })
            }
          />
          <input
            type="date"
            className="h-7 px-2 text-xs rounded border border-border bg-background"
            value={range.to ? new Date(range.to).toISOString().slice(0, 10) : ''}
            onChange={(e) =>
              setRange({ ...range, to: e.target.value ? new Date(e.target.value).getTime() : null })
            }
          />
        </>
      )}
    </div>
  )
}
