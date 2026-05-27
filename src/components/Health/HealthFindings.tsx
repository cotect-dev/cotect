import { useMemo } from 'react'
import { useHealthStore } from '@/store/health'
import type { Severity, FindingType, Finding, FileMetrics } from '@/services/structureAnalyzer'
import { AlertCircle, AlertTriangle, Info, HelpCircle } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { navigateToFile } from './navigateToFile'

const SEVERITY_ICON: Record<Severity, React.ReactNode> = {
  error: <AlertCircle className="h-4 w-4 text-red-400" />,
  warning: <AlertTriangle className="h-4 w-4 text-yellow-400" />,
  info: <Info className="h-4 w-4 text-blue-400" />,
}

const SEVERITY_LABEL: Record<Severity, string> = {
  error: 'Errors',
  warning: 'Warnings',
  info: 'Info',
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

const FINDING_TOOLTIPS: Partial<Record<FindingType, string>> = {
  'circular-dependency':
    'Files that import each other in a cycle. Circular dependencies make code harder to refactor and can cause subtle initialization bugs.',
  'high-fan-in':
    'Files imported by many others. Changes here have a wide blast radius — consider if the API surface is too broad.',
  'high-fan-out':
    'Files that import many others. High fan-out often means a file is doing too much — consider splitting responsibilities.',
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

function shortPath(path: string): string {
  const parts = path.split('/')
  return parts.length > 2 ? parts.slice(-2).join('/') : path
}

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
    case 'mixed-layers': {
      const match = finding.message.match(/(\d+)\s+(different\s+)?layers/)
      return match ? `${match[1]} layers` : ''
    }
    case 'wide-folder': {
      const match = finding.message.match(/(\d+)\s+files/)
      return match ? `${match[1]} files` : ''
    }
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
    const grouped = new Map<Severity, Map<FindingType, FileEntry[]>>()

    for (const sev of ['error', 'warning', 'info'] as Severity[]) {
      grouped.set(sev, new Map())
    }

    for (const f of findings) {
      const typeMap = grouped.get(f.severity)!
      if (!typeMap.has(f.type)) typeMap.set(f.type, [])
      const entries = typeMap.get(f.type)!

      if (f.type === 'circular-dependency') {
        entries.push({
          file: f.files.map(shortPath).join(' → '),
          value: `${f.files.length} files`,
          sortKey: f.files.length,
          finding: f,
        })
      } else if (f.type === 'wide-folder') {
        const match = f.message.match(/^Wide folder: (.+?) has (\d+) files/)
        entries.push({
          file: match?.[1] ?? f.files[0],
          value: `${match?.[2] ?? f.files.length} files`,
          sortKey: f.files.length,
          finding: f,
        })
      } else if (f.type === 'layer-violation') {
        const match = f.message.match(/\((.+?)\): (\d+) import/)
        entries.push({
          file: match?.[1] ?? f.type,
          value: `${match?.[2] ?? f.files.length} imports`,
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
      for (const [type, entries] of typeMap) {
        entries.sort((a, b) => b.sortKey - a.sortKey)
        if (entries.length > MAX_FILES_PER_CARD) {
          typeMap.set(type, entries.slice(0, MAX_FILES_PER_CARD))
        }
      }
    }

    return grouped
  }, [findings, metricsMap])

  const hasAny = findings.length > 0

  return (
    <TooltipProvider>
      <div className="p-6 max-w-4xl space-y-8">
        {!hasAny && (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No findings — clean codebase!
          </div>
        )}

        {(['error', 'warning', 'info'] as Severity[]).map((severity) => {
          const typeMap = bySeverity.get(severity)!
          if (typeMap.size === 0) return null
          return (
            <section key={severity} className="space-y-3">
              <div className="flex items-center gap-2">
                {SEVERITY_ICON[severity]}
                <h2 className="text-sm font-semibold text-foreground">
                  {SEVERITY_LABEL[severity]}
                </h2>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[...typeMap.entries()].map(([type, entries]) => (
                  <FindingCard
                    key={type}
                    type={type}
                    entries={entries}
                    totalCount={findings.filter((f) => f.type === type).length}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </TooltipProvider>
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
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-xs font-medium text-foreground">{FINDING_LABELS[type] ?? type}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
          {totalCount}
        </span>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger className="inline-flex cursor-help">
              <HelpCircle className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="space-y-1.5">
        {entries.map((entry, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-xs">
            {isNavigable ? (
              <button
                type="button"
                onClick={() => navigateToFile(entry.file)}
                className="truncate text-foreground/80 hover:text-primary cursor-pointer text-left font-mono"
                title={entry.file}
              >
                {shortPath(entry.file)}
              </button>
            ) : (
              <span className="truncate text-foreground/80 font-mono" title={entry.file}>
                {entry.file}
              </span>
            )}
            {entry.value && (
              <span className="shrink-0 text-muted-foreground tabular-nums">{entry.value}</span>
            )}
          </div>
        ))}
        {totalCount > MAX_FILES_PER_CARD && (
          <div className="text-[10px] text-muted-foreground/60 pt-1">
            +{totalCount - MAX_FILES_PER_CARD} more
          </div>
        )}
      </div>
    </div>
  )
}
