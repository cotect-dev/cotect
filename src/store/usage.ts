import { create } from 'zustand'
import { createStoreWithHMR } from '@/lib/hmr'
import { listen } from '@tauri-apps/api/event'
import {
  usageQuery, usageAggregate,
  type UsageRecord, type AggregateRow, type UsageFilter, type GroupBy,
} from '@/services/db'

export type RangePreset = 'today' | '7d' | '30d' | 'all' | 'custom'

export interface DateRange {
  preset: RangePreset
  from: number | null
  to: number | null
}

function rangeToFilter(range: DateRange): UsageFilter {
  return { from_ts: range.from, to_ts: range.to, provider_id: null, model: null, role: null, limit: null }
}

interface UsageState {
  range: DateRange
  setRange: (r: DateRange) => void

  headline: { tokens: number; tasks: number; p50_first_token: number | null; p50_total: number | null } | null
  spendByProvider: AggregateRow[] | null
  spendByRole: AggregateRow[] | null
  latencyByModel: AggregateRow[] | null
  breakdown: AggregateRow[] | null
  tasks: UsageRecord[] | null

  refresh: () => Promise<void>
  start: () => () => void
}

const SEVEN: DateRange = { preset: '7d', from: Date.now() - 7 * 86_400_000, to: null }

function presetToRange(preset: RangePreset): DateRange {
  switch (preset) {
    case 'today': return { preset, from: new Date().setHours(0, 0, 0, 0), to: null }
    case '7d':    return { preset, from: Date.now() - 7  * 86_400_000, to: null }
    case '30d':   return { preset, from: Date.now() - 30 * 86_400_000, to: null }
    case 'all':   return { preset, from: null, to: null }
    case 'custom':return { preset, from: null, to: null }   // caller fills in
  }
}

async function refreshAll(get: () => UsageState, set: (p: Partial<UsageState>) => void): Promise<void> {
  const filter = rangeToFilter(get().range)
  const [byProvider, byRole, byModel, byTuple, recent] = await Promise.all([
    usageAggregate(filter, 'Provider' as GroupBy),
    usageAggregate(filter, 'Role' as GroupBy),
    usageAggregate(filter, 'Model' as GroupBy),
    usageAggregate(filter, 'ProviderDay' as GroupBy),
    usageQuery({ ...filter, limit: 500 }),
  ])
  const tasks = recent.length
  const tokens = recent.reduce((s, r) => s + r.prompt_tokens + r.completion_tokens, 0)
  const ftSorted = recent.map((r) => r.first_token_ms).filter((v): v is number => v != null).sort((a, b) => a - b)
  const totSorted = recent.map((r) => r.total_ms).filter((v): v is number => v != null).sort((a, b) => a - b)
  set({
    headline: {
      tokens, tasks,
      p50_first_token: ftSorted[Math.floor(ftSorted.length / 2)] ?? null,
      p50_total: totSorted[Math.floor(totSorted.length / 2)] ?? null,
    },
    spendByProvider: byProvider,
    spendByRole: byRole,
    latencyByModel: byModel,
    breakdown: byTuple,
    tasks: recent,
  })
}

export const useUsageStore = createStoreWithHMR(import.meta.hot, 'usage', () =>
  create<UsageState>((set, get) => ({
    range: SEVEN,
    setRange: (r) => { set({ range: r }); void refreshAll(get, set) },

    headline: null, spendByProvider: null, spendByRole: null, latencyByModel: null, breakdown: null, tasks: null,

    refresh: () => refreshAll(get, set),

    start: () => {
      void refreshAll(get, set)
      const promise = listen<UsageRecord>('usage:appended', () => { void refreshAll(get, set) })
      return () => { void promise.then((unlisten) => unlisten()) }
    },
  })),
)

export { presetToRange }
