import { useMemo } from 'react'
import { useHealthStore } from '@/store/health'
import type { Severity, FindingType, Finding, FileMetrics } from '@/services/structureAnalyzer'
import {
  AlertTriangle,
  Info,
  RefreshCw,
  ArrowDownToLine,
  ArrowUpFromLine,
  Crown,
  Unplug,
  Layers,
  Layers2,
  Link2,
  Network,
  FileWarning,
  FolderTree,
  FlaskConical,
} from 'lucide-react'
import { Section, InfoTip, FileLink } from './shared'
import { shortPath } from './format'

const SEVERITY_ICON: Record<Severity, React.ReactNode> = {
  error: <AlertTriangle className="h-4 w-4 text-amber-400" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-400" />,
  info: <Info className="h-4 w-4 text-muted-foreground" />,
}

const SEVERITY_LABEL: Record<Severity, string> = {
  error: 'Needs attention',
  warning: 'Warnings',
  info: 'Notes',
}

const FINDING_LABELS: Record<FindingType, string> = {
  'circular-dependency': 'Circular Dependencies',
  'high-fan-in': 'High Fan-In',
  'high-fan-out': 'High Fan-Out',
  'god-module': 'God Modules',
  orphan: 'Orphan Files',
  'layer-violation': 'Layer Violations',
  'deep-chain': 'Deep Dependency Chains',
  'hub-bottleneck': 'Hub Bottlenecks',
  'large-file': 'Large Files',
  'wide-folder': 'Wide Folders',
  'missing-test': 'Missing Tests',
  'mixed-layers': 'Mixed-Layer Imports',
}

const FINDING_ICON: Record<FindingType, React.ReactNode> = {
  'circular-dependency': <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />,
  'high-fan-in': <ArrowDownToLine className="h-3.5 w-3.5 text-muted-foreground" />,
  'high-fan-out': <ArrowUpFromLine className="h-3.5 w-3.5 text-muted-foreground" />,
  'god-module': <Crown className="h-3.5 w-3.5 text-muted-foreground" />,
  orphan: <Unplug className="h-3.5 w-3.5 text-muted-foreground" />,
  'layer-violation': <Layers className="h-3.5 w-3.5 text-muted-foreground" />,
  'deep-chain': <Link2 className="h-3.5 w-3.5 text-muted-foreground" />,
  'hub-bottleneck': <Network className="h-3.5 w-3.5 text-muted-foreground" />,
  'large-file': <FileWarning className="h-3.5 w-3.5 text-muted-foreground" />,
  'wide-folder': <FolderTree className="h-3.5 w-3.5 text-muted-foreground" />,
  'missing-test': <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />,
  'mixed-layers': <Layers2 className="h-3.5 w-3.5 text-muted-foreground" />,
}

const FINDING_TOOLTIPS: Partial<Record<FindingType, string>> = {
  'circular-dependency':
    'Files that import each other in a cycle. Circular dependencies make code harder to refactor and can cause subtle initialization bugs.',
  'high-fan-in':
    'Files imported by many others. Changes here have a wide blast radius. Consider whether the API surface is too broad.',
  'high-fan-out':
    'Files that import many others. High fan-out often means a file is doing too much. Consider splitting responsibilities.',
  'god-module':
    'Files with both high fan-in and high fan-out. These tend to accumulate complexity and become maintenance bottlenecks.',
  orphan: 'Files not imported by anything. May be dead code, or an entry point that was missed.',
  'layer-violation':
    'Imports that flow upward in the architecture (e.g., a service importing from a component). These break the intended dependency direction.',
  'deep-chain':
    'Files at the end of long transitive import chains. Deep chains slow builds and make change impact hard to predict.',
  'hub-bottleneck':
    'Files imported from 3+ architectural layers. Cross-cutting hubs are hard to evolve without breaking multiple layers.',
  'large-file':
    'Files exceeding the line count threshold. Large files are harder to navigate, review, and test.',
  'wide-folder': 'Folders with many files. May benefit from sub-folders or module extraction.',
  'missing-test':
    'Source files with dependencies but no corresponding test file. Higher-connectivity files benefit most from tests.',
  'mixed-layers':
    'Files importing from 4+ different architectural layers. May indicate unclear responsibilities.',
}

const MAX_FILES_PER_CARD = 10

function getFileValue(
  type: FindingType,
  file: string,
  metricsMap: Map<string, FileMetrics>,
  finding: Finding,
): string {
  const m = metricsMap.get(file)
  switch (type) {
    case 'high-fan-in':
      return `${m?.inDegree ?? '?'} importers`
    case 'high-fan-out':
      return `${m?.outDegree ?? '?'} imports`
    case 'god-module':
      return `${m?.inDegree ?? '?'} in / ${m?.outDegree ?? '?'} out`
    case 'deep-chain':
      return `depth ${m?.longestChainDepth ?? '?'}`
    case 'large-file':
      return `${m?.lineCount ?? '?'} lines`
    case 'orphan':
      return '0 importers'
    case 'missing-test':
      return 'no test'
    case 'hub-bottleneck':
    case 'mixed-layers':
      return finding.detail?.count != null ? `${finding.detail.count} layers` : ''
    case 'circular-dependency':
      return `${finding.files.length} files in cycle`
    case 'layer-violation':
      return ''
    default:
      return ''
  }
}

interface FileEntry {
  file: string
  value: string
  sortKey: number
  finding: Finding
}

export default function HealthFindings() {
  const findings = useHealthStore((s) => s.findings)
  const metrics = useHealthStore((s) => s.metrics)

  const metricsMap = useMemo(() => new Map(metrics.map((m) => [m.path, m])), [metrics])

  const bySeverity = useMemo(() => {
    const grouped = new Map<Severity, Map<FindingType, { entries: FileEntry[]; total: number }>>()

    for (const sev of ['error', 'warning', 'info'] as Severity[]) {
      grouped.set(sev, new Map())
    }

    for (const f of findings) {
      const typeMap = grouped.get(f.severity)!
      if (!typeMap.has(f.type)) typeMap.set(f.type, { entries: [], total: 0 })
      const entries = typeMap.get(f.type)!.entries

      if (f.type === 'circular-dependency') {
        entries.push({
          file: f.files.map(shortPath).join(' → '),
          value: `${f.files.length} files`,
          sortKey: f.files.length,
          finding: f,
        })
      } else if (f.type === 'wide-folder') {
        entries.push({
          file: f.detail?.group ?? f.files[0],
          value: `${f.detail?.count ?? f.files.length} files`,
          sortKey: f.files.length,
          finding: f,
        })
      } else if (f.type === 'layer-violation') {
        entries.push({
          file: f.detail?.group ?? f.type,
          value: `${f.detail?.count ?? f.files.length} imports`,
          sortKey: f.files.length,
          finding: f,
        })
      } else {
        for (const file of f.files) {
          const m = metricsMap.get(file)
          let sortKey = 0
          switch (f.type) {
            case 'high-fan-in':
              sortKey = m?.inDegree ?? 0
              break
            case 'high-fan-out':
              sortKey = m?.outDegree ?? 0
              break
            case 'god-module':
              sortKey = (m?.inDegree ?? 0) + (m?.outDegree ?? 0)
              break
            case 'deep-chain':
              sortKey = m?.longestChainDepth ?? 0
              break
            case 'large-file':
              sortKey = m?.lineCount ?? 0
              break
            default:
              sortKey = 0
          }
          entries.push({
            file,
            value: getFileValue(f.type, file, metricsMap, f),
            sortKey,
            finding: f,
          })
        }
      }
    }

    for (const typeMap of grouped.values()) {
      for (const [type, group] of typeMap) {
        group.entries.sort((a, b) => b.sortKey - a.sortKey)
        const total = group.entries.length
        typeMap.set(type, { entries: group.entries.slice(0, MAX_FILES_PER_CARD), total })
      }
    }

    return grouped
  }, [findings, metricsMap])

  if (findings.length === 0) {
    return (
      <Section title="Architecture findings">
        <div className="rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
          No findings. Clean codebase!
        </div>
      </Section>
    )
  }

  return (
    <Section
      title="Architecture findings"
      subtitle="Structural signals from the import graph. Heuristics rather than hard errors, use as review hints."
    >
      <div className="space-y-6">
        {(['error', 'warning', 'info'] as Severity[]).map((severity) => {
          const typeMap = bySeverity.get(severity)!
          if (typeMap.size === 0) return null
          return (
            <div key={severity} className="space-y-3">
              <div className="flex items-center gap-2">
                {SEVERITY_ICON[severity]}
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {SEVERITY_LABEL[severity]}
                </h3>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {[...typeMap.entries()].map(([type, group]) => (
                  <FindingCard
                    key={type}
                    type={type}
                    entries={group.entries}
                    totalCount={group.total}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

function FindingCard({
  type,
  entries,
  totalCount,
}: {
  type: FindingType
  entries: FileEntry[]
  totalCount: number
}) {
  const isNavigable =
    type !== 'circular-dependency' && type !== 'layer-violation' && type !== 'wide-folder'
  const tooltip = FINDING_TOOLTIPS[type]

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-1.5">
        <span className="shrink-0">{FINDING_ICON[type]}</span>
        <span className="text-xs font-medium text-foreground">{FINDING_LABELS[type] ?? type}</span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {totalCount}
        </span>
        {tooltip && <InfoTip text={tooltip} />}
      </div>
      <div className="space-y-1.5">
        {entries.map((entry, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-xs">
            {isNavigable ? (
              <FileLink path={entry.file} className="min-w-0 flex-1" />
            ) : (
              <span
                className="min-w-0 flex-1 truncate font-mono text-foreground/80"
                title={entry.file}
              >
                {entry.file}
              </span>
            )}
            {entry.value && (
              <span className="shrink-0 tabular-nums text-muted-foreground">{entry.value}</span>
            )}
          </div>
        ))}
        {totalCount > entries.length && (
          <div className="pt-1 text-[10px] text-muted-foreground/60">
            +{totalCount - entries.length} more
          </div>
        )}
      </div>
    </div>
  )
}
