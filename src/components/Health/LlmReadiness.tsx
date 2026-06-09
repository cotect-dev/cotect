import { useHealthStore } from '@/store/health'
import { DEFAULT_CONTEXT_WINDOW } from '@/lib/llmContext'
import { Section, FileLink } from './shared'
import { AlertTriangle } from 'lucide-react'

const TOP_N = 12

function fmtTokens(t: number): string {
  return t >= 1000 ? `${(t / 1000).toFixed(1)}k` : `${t}`
}

export default function LlmReadiness() {
  const fileSizes = useHealthStore((s) => s.fileSizes)
  if (fileSizes.length === 0) return null

  const risky = fileSizes.filter((f) => f.isRisky)
  const rows = (risky.length > 0 ? risky : fileSizes).slice(0, TOP_N)
  const windowK = `${Math.round(DEFAULT_CONTEXT_WINDOW / 1000)}k`

  return (
    <Section
      title="LLM readiness"
      subtitle={
        risky.length > 0
          ? `${risky.length} large file${risky.length > 1 ? 's' : ''} may be hard to edit reliably with an LLM.`
          : 'Largest files by estimated token size.'
      }
      tooltip={`Estimated tokens ≈ characters ÷ 4, shown against a ${windowK}-token reference window. Code-editing accuracy degrades as a file grows large relative to the context window.`}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((f) => (
          <div
            key={f.path}
            className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <FileLink path={f.path} className="text-xs" />
              <div className="text-[11px] tabular-nums text-muted-foreground">
                ~{fmtTokens(f.tokens)} tok · {(f.contextFraction * 100).toFixed(1)}% of {windowK}
              </div>
            </div>
            {f.isRisky && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
          </div>
        ))}
      </div>
    </Section>
  )
}
