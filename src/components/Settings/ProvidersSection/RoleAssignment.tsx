import type { Provider, ActiveAssignment } from '@/services/db'
import type { DetectedView } from './types'
import { useProvidersStore } from '@/store/providers'

const ROLES = ['default', 'implement', 'research', 'plan'] as const
type RoleKey = typeof ROLES[number]

function readSlot(a: ActiveAssignment | null, key: RoleKey): { providerId: string | null; model: string | null } {
  if (!a) return { providerId: null, model: null }
  switch (key) {
    case 'default':   return { providerId: a.default_provider_id,   model: a.default_model }
    case 'implement': return { providerId: a.implement_provider_id, model: a.implement_model }
    case 'research':  return { providerId: a.research_provider_id,  model: a.research_model }
    case 'plan':      return { providerId: a.plan_provider_id,      model: a.plan_model }
  }
}

function writeSlot(a: ActiveAssignment, key: RoleKey, providerId: string | null, model: string | null): ActiveAssignment {
  switch (key) {
    case 'default':   return { ...a, default_provider_id: providerId,   default_model: model }
    case 'implement': return { ...a, implement_provider_id: providerId, implement_model: model }
    case 'research':  return { ...a, research_provider_id: providerId,  research_model: model }
    case 'plan':      return { ...a, plan_provider_id: providerId,      plan_model: model }
  }
}

const EMPTY: ActiveAssignment = {
  default_provider_id: null, default_model: null,
  implement_provider_id: null, implement_model: null,
  research_provider_id: null, research_model: null,
  plan_provider_id: null, plan_model: null,
}

export default function RoleAssignment({
  provider, detected, assignment,
}: { provider: Provider; detected: DetectedView | null; assignment: ActiveAssignment | null }) {
  const setAssignment = useProvidersStore((s) => s.setAssignment)
  const a = assignment ?? EMPTY
  const models = detected?.models ?? []

  const onPick = async (key: RoleKey, modelId: string) => {
    const next = modelId === '__unset' ? writeSlot(a, key, null, null) : writeSlot(a, key, provider.id, modelId)
    await setAssignment(next)
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px]">
      <div className="text-muted-foreground text-[10px] uppercase tracking-wider">Role assignment</div>
      {ROLES.map((role) => {
        const slot = readSlot(a, role)
        const isThisProvider = slot.providerId === provider.id
        const showFallback = role !== 'default' && !isThisProvider && a.default_provider_id != null
        return (
          <div key={role} className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground capitalize">{role}</span>
            <select
              className="h-6 px-1.5 text-[11px] rounded border border-border bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              value={isThisProvider ? slot.model ?? '__unset' : '__unset'}
              onChange={(e) => void onPick(role, e.target.value)}
            >
              <option value="__unset">{showFallback ? '↳ default' : '—'}</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.id}</option>
              ))}
            </select>
          </div>
        )
      })}
    </div>
  )
}
