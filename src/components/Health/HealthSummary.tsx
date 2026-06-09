import { useMemo } from 'react'
import { useHealthStore } from '@/store/health'
import { InfoTip } from './shared'

export default function HealthSummary() {
  const findings = useHealthStore((s) => s.findings)
  const metrics = useHealthStore((s) => s.metrics)
  const fileSizes = useHealthStore((s) => s.fileSizes)

  const issues = useMemo(() => {
    let attention = 0
    let notes = 0
    for (const f of findings) {
      if (f.severity === 'info') notes++
      else attention++
    }
    return { attention, notes }
  }, [findings])

  const sourceFiles = useMemo(() => metrics.filter((m) => !m.isTest).length, [metrics])

  const testPresence = useMemo(() => {
    const nonTest = metrics.filter((m) => !m.isTest)
    const missingTestFiles = new Set(
      findings.filter((f) => f.type === 'missing-test').flatMap((f) => f.files),
    )
    const withTest = nonTest.filter((m) => !missingTestFiles.has(m.path)).length
    return nonTest.length > 0 ? Math.round((withTest / nonTest.length) * 100) : 100
  }, [metrics, findings])

  const riskyCount = useMemo(() => fileSizes.filter((f) => f.isRisky).length, [fileSizes])

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Chip
        label="Source files"
        value={sourceFiles}
        hint={`${metrics.length} files including tests`}
      />
      <Chip
        label="Needs attention"
        value={issues.attention}
        tone={issues.attention > 0 ? 'warn' : 'default'}
      />
      <Chip label="Notes" value={issues.notes} tone="muted" />
      <Chip
        label="Test presence"
        value={`${testPresence}%`}
        hint="Share of source files with a matching *.test.* / *.spec.* file. A heuristic — not line coverage."
      />
      <Chip
        label="LLM-risky files"
        value={riskyCount}
        tone={riskyCount > 0 ? 'warn' : 'default'}
        hint="Files large enough (by estimated tokens) that an LLM may struggle to edit them reliably."
      />
    </div>
  )
}

function Chip({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'warn' | 'muted'
}) {
  const valueColor =
    tone === 'warn'
      ? 'text-amber-400'
      : tone === 'muted'
        ? 'text-muted-foreground'
        : 'text-foreground'
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-1 flex items-center gap-1">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        {hint && <InfoTip text={hint} />}
      </div>
      <div className={`text-xl font-semibold tabular-nums ${valueColor}`}>{value}</div>
    </div>
  )
}
