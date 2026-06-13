import Graph from '@/components/Graph'

// The phone counterpart to GraphDemo. It is the *same* real Graph component the
// desktop uses (folder backgrounds, real import/imported-by edge colors and
// routing) — just trimmed to a readable slice by excluding a few files, and
// rendered non-interactively so the static diagram never traps page scroll.
// The graph centers on its highest-score node (client.ts), so dropping the net
// layer and routes leaves: src/lib {log, queue} -> src/api {client} -> src {index}.
const EXCLUDE = ['src/net/fetchWithRetry.ts', 'src/net/http.ts', 'src/api/routes.ts']

export function MobileGraphDemo() {
  return (
    <div className="relative h-[340px] overflow-hidden rounded-lg border border-border bg-background">
      <Graph excludeIds={EXCLUDE} interactive={false} />
    </div>
  )
}
