import { List, type RowComponentProps } from 'react-window'
import { useUsageStore } from '@/store/usage'
import type { UsageRecord } from '@/services/db'

const GRID_COLS = 'grid-cols-[140px_120px_120px_100px_1fr_80px_80px]'

type RowProps = { rows: UsageRecord[] }

function Row({ index, style, ariaAttributes, rows }: RowComponentProps<RowProps>) {
  const r = rows[index]
  return (
    <div
      style={style}
      {...ariaAttributes}
      className={`grid ${GRID_COLS} px-3 py-1.5 border-t border-border text-[11px] font-mono items-center`}
    >
      <div className="text-muted-foreground">{new Date(r.ts).toLocaleString()}</div>
      <div className="truncate">{r.task_id ?? '—'}</div>
      <div className="truncate">{r.provider_id}</div>
      <div className="truncate">{r.model}</div>
      <div className="truncate">{r.role}</div>
      <div>{r.prompt_tokens + r.completion_tokens}</div>
      <div>{r.total_ms != null ? `${r.total_ms}ms` : '—'}</div>
    </div>
  )
}

export default function TaskList() {
  const rows = useUsageStore((s) => s.tasks) ?? []
  if (rows.length === 0) return null

  return (
    <div className="flex flex-col gap-2 p-4 rounded-lg border border-border bg-card">
      <h3 className="text-xs font-semibold">Tasks ({rows.length})</h3>
      <div className="border border-border rounded overflow-x-auto">
        <div className="min-w-[720px]">
          <div
            className={`grid ${GRID_COLS} bg-muted/40 px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium`}
          >
            <div>When</div>
            <div>Task ID</div>
            <div>Provider</div>
            <div>Model</div>
            <div>Role</div>
            <div>Tokens</div>
            <div>Total</div>
          </div>
          <List
            style={{ height: 400 }}
            rowCount={rows.length}
            rowHeight={28}
            rowComponent={Row}
            rowProps={{ rows }}
          />
        </div>
      </div>
    </div>
  )
}
