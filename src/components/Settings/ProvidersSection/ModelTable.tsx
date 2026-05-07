import { useMemo, useState } from 'react'
import type { Provider, ActiveAssignment } from '@/services/db'
import type { DetectedView } from './types'

type Role = 'implement' | 'research' | 'plan'

function rolesAssignedToModel(a: ActiveAssignment | null, providerId: string, modelId: string): Role[] {
  if (!a) return []
  const out: Role[] = []
  if (a.implement_provider_id === providerId && a.implement_model === modelId) out.push('implement')
  if (a.research_provider_id  === providerId && a.research_model  === modelId) out.push('research')
  if (a.plan_provider_id      === providerId && a.plan_model      === modelId) out.push('plan')
  return out
}

export default function ModelTable({
  provider, detected, assignment,
}: { provider: Provider; detected: DetectedView; assignment: ActiveAssignment | null }) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const lower = q.toLowerCase()
    return detected.models.filter((m) => m.id.toLowerCase().includes(lower))
  }, [detected.models, q])

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <input
          className="h-7 px-2 text-[11px] rounded border border-border bg-background w-[240px] font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Search models…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="text-[10px] text-muted-foreground">{filtered.length} of {detected.models.length}</span>
      </div>
      <div className="border border-border rounded-md overflow-x-auto">
        <div className="min-w-[420px]">
          <div className="grid grid-cols-[1fr_64px_64px_64px_72px] gap-0 bg-muted/40 px-2.5 py-1 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
            <div>Model</div><div>Family</div><div>Format</div><div>Ctx</div><div>Roles</div>
          </div>
          {filtered.slice(0, 50).map((m) => {
            const roles = rolesAssignedToModel(assignment, provider.id, m.id)
            const fmt = detected.format_per_model[m.id]
            return (
              <div key={m.id} className="grid grid-cols-[1fr_64px_64px_64px_72px] gap-0 px-2.5 py-1.5 border-t border-border text-[11px] font-mono items-center">
                <div className="truncate">{m.id}</div>
                <div className="text-muted-foreground truncate">{m.family ?? '—'}</div>
                <div className="text-muted-foreground truncate">{fmt ?? '—'}</div>
                <div className="text-muted-foreground">{m.context ? `${Math.round(m.context/1024)}k` : '—'}</div>
                <div className="flex gap-1">
                  {roles.map((r) => (
                    <span key={r} className="text-[9px] bg-primary/20 text-primary px-1 py-0 rounded">{r.slice(0,4)}</span>
                  ))}
                </div>
              </div>
            )
          })}
          {filtered.length > 50 && (
            <div className="px-2.5 py-1 border-t border-border text-[10px] text-muted-foreground text-center">
              …and {filtered.length - 50} more — search to filter
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
