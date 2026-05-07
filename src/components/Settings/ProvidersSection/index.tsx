import { useProvidersStore } from '@/store/providers'
import AddProviderRow from './AddProviderRow'
import ProviderCard from './ProviderCard'

export default function ProvidersSection() {
  const providers = useProvidersStore((s) => s.providers)
  const assignment = useProvidersStore((s) => s.assignment)

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">Providers</h2>
      <AddProviderRow />
      {providers.length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-6 rounded-lg border border-dashed border-border">
          No providers yet — add one above.
        </div>
      )}
      {providers.map((p) => (
        <ProviderCard key={p.id} provider={p} assignment={assignment} />
      ))}
    </div>
  )
}
