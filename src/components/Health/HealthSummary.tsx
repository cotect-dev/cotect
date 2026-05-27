import { useMemo } from 'react'
import { useHealthStore } from '@/store/health'
import {
  AlertCircle,
  AlertTriangle,
  Info as InfoIcon,
  Flame,
  GitCommitHorizontal,
  Link2,
  FlaskConical,
  HelpCircle,
} from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { navigateToFile } from './navigateToFile'

export default function HealthSummary() {
  const findings = useHealthStore((s) => s.findings)
  const metrics = useHealthStore((s) => s.metrics)
  const hotspots = useHealthStore((s) => s.hotspots)
  const churn = useHealthStore((s) => s.churn)
  const coupling = useHealthStore((s) => s.coupling)

  const severityCounts = useMemo(() => {
    const counts = { error: 0, warning: 0, info: 0 }
    for (const f of findings) counts[f.severity]++
    return counts
  }, [findings])

  const fileStats = useMemo(() => {
    const nonTest = metrics.filter((m) => !m.isTest)
    const totalLines = nonTest.reduce((sum, m) => sum + m.lineCount, 0)
    return {
      total: metrics.length,
      nonTest: nonTest.length,
      totalLines,
      avgLines: nonTest.length > 0 ? Math.round(totalLines / nonTest.length) : 0,
    }
  }, [metrics])

  const testCoverage = useMemo(() => {
    const nonTest = metrics.filter((m) => !m.isTest)
    const missingTestFiles = new Set(
      findings.filter((f) => f.type === 'missing-test').flatMap((f) => f.files),
    )
    const withTest = nonTest.filter((m) => !missingTestFiles.has(m.path)).length
    return nonTest.length > 0 ? Math.round((withTest / nonTest.length) * 100) : 100
  }, [metrics, findings])

  return (
    <TooltipProvider>
      <div className="p-6 space-y-6 max-w-5xl">
        <div className="grid grid-cols-3 gap-4">
          <Card
            icon={<AlertCircle className="h-4 w-4 text-red-400" />}
            label="Errors"
            value={severityCounts.error}
            color="text-red-400"
          />
          <Card
            icon={<AlertTriangle className="h-4 w-4 text-yellow-400" />}
            label="Warnings"
            value={severityCounts.warning}
            color="text-yellow-400"
          />
          <Card
            icon={<InfoIcon className="h-4 w-4 text-blue-400" />}
            label="Info"
            value={severityCounts.info}
            color="text-blue-400"
          />
        </div>

        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Files" value={fileStats.total} />
          <StatCard label="Source files" value={fileStats.nonTest} />
          <StatCard label="Total lines" value={fileStats.totalLines.toLocaleString()} />
          <StatCard label="Avg lines/file" value={fileStats.avgLines} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <StatCard
            label="Test coverage (approx)"
            value={`${testCoverage}%`}
            icon={<FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />}
            tooltip="Percentage of source files that have a corresponding test file. Based on naming conventions (*.test.*, *.spec.*)."
          />
          <StatCard
            label="Change-coupled pairs"
            value={coupling.length}
            icon={<Link2 className="h-3.5 w-3.5 text-muted-foreground" />}
            tooltip="File pairs that frequently change together in the same commit. High coupling between unrelated files may indicate hidden dependencies."
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <ListCard
            title="Hotspots"
            icon={<Flame className="h-3.5 w-3.5 text-orange-400" />}
            tooltip="Files that change frequently AND are depended on by many others. These are the riskiest files — bugs here have the widest blast radius."
            valueLabel="Score — higher means riskier"
            items={hotspots.slice(0, 7).map((h) => ({
              label: shortPath(h.path),
              value: h.hotspotScore.toFixed(2),
              path: h.path,
            }))}
            emptyText="No hotspots detected"
          />
          <ListCard
            title="Highest Churn"
            icon={<GitCommitHorizontal className="h-3.5 w-3.5 text-green-400" />}
            tooltip="Files with the most commits in recent history. High churn can indicate unstable code, evolving requirements, or files that need refactoring."
            valueLabel="Number of commits touching this file"
            items={churn.slice(0, 7).map((c) => ({
              label: shortPath(c.path),
              value: `${c.commitCount} commits`,
              path: c.path,
            }))}
            emptyText="No git history available"
          />
          <ListCard
            title="Strongest Coupling"
            icon={<Link2 className="h-3.5 w-3.5 text-violet-400" />}
            tooltip="File pairs that are almost always changed in the same commit. If these files aren't directly related, consider merging them or extracting shared logic."
            valueLabel="Times changed together"
            items={coupling.slice(0, 7).map((c) => ({
              label: `${shortPath(c.fileA)} + ${shortPath(c.fileB)}`,
              value: `${c.coChangeCount}x`,
            }))}
            emptyText="No coupled pairs detected"
          />
        </div>
      </div>
    </TooltipProvider>
  )
}

function shortPath(path: string): string {
  const parts = path.split('/')
  return parts.length > 2 ? parts.slice(-2).join('/') : path
}

function Card({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: number
  color: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 flex items-center gap-3">
      {icon}
      <div>
        <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  icon,
  tooltip,
}: {
  label: string
  value: string | number
  icon?: React.ReactNode
  tooltip?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
        {tooltip && <InfoPopover text={tooltip} />}
      </div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function InfoPopover({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger className="inline-flex cursor-help">
        <HelpCircle className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

function ListCard({
  title,
  icon,
  items,
  emptyText,
  tooltip,
  valueLabel,
}: {
  title: string
  icon: React.ReactNode
  items: { label: string; value: string; path?: string }[]
  emptyText: string
  tooltip?: string
  valueLabel?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 mb-3">
        {icon}
        <span className="text-xs font-medium text-foreground">{title}</span>
        {tooltip && <InfoPopover text={tooltip} />}
      </div>
      {items.length === 0 ? (
        <span className="text-xs text-muted-foreground">{emptyText}</span>
      ) : (
        <div className="space-y-1.5">
          {valueLabel && (
            <div className="text-[10px] text-muted-foreground/60 text-right">{valueLabel}</div>
          )}
          {items.map((item, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-xs">
              {item.path ? (
                <button
                  type="button"
                  onClick={() => navigateToFile(item.path!)}
                  className="truncate text-foreground/80 hover:text-primary cursor-pointer text-left"
                  title={item.path}
                >
                  {item.label}
                </button>
              ) : (
                <span className="truncate text-foreground/80" title={item.label}>
                  {item.label}
                </span>
              )}
              <span className="shrink-0 text-muted-foreground tabular-nums">{item.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
