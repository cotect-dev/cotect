import { parseImports } from '@/services/treesitter'
import { resolveImport } from '@/services/importResolver'
import { getConfigForFile, PARSEABLE_EXTENSIONS } from '@/services/treesitter-queries'
import { isTestFile } from '@/lib/fileClassification'
import { HIDDEN_DIRECTORIES } from '@/lib/constants'
import { toRepoRelative } from '@/lib/repoPath'
import { getPlatform } from '@/services/platform'

export type FindingType =
  | 'circular-dependency'
  | 'high-fan-in'
  | 'high-fan-out'
  | 'god-module'
  | 'orphan'
  | 'layer-violation'
  | 'deep-chain'
  | 'hub-bottleneck'
  | 'large-file'
  | 'wide-folder'
  | 'missing-test'
  | 'mixed-layers'

export type Severity = 'info' | 'warning' | 'error'

export interface Finding {
  type: FindingType
  severity: Severity
  files: string[]
  message: string
}

export interface FileMetrics {
  path: string
  folder: string
  layer: string
  lineCount: number
  inDegree: number
  outDegree: number
  isTest: boolean
  longestChainDepth: number
}

export interface AnalysisResult {
  findings: Finding[]
  metrics: FileMetrics[]
  graph: { nodes: string[]; edges: [string, string][] }
}

export interface AnalysisConfig {
  fanInThreshold: number
  fanOutThreshold: number
  depthThreshold: number
  maxFiles: number
  largeFileThreshold: number
  wideFolderThreshold: number
  mixedLayerThreshold: number
}

const DEFAULT_CONFIG: AnalysisConfig = {
  fanInThreshold: 10,
  fanOutThreshold: 15,
  depthThreshold: 8,
  maxFiles: 500,
  largeFileThreshold: 300,
  wideFolderThreshold: 15,
  mixedLayerThreshold: 4,
}

const LAYER_ORDER: Record<string, number> = {
  types: 0,
  lib: 1,
  services: 2,
  store: 3,
  hooks: 4,
  components: 5,
  views: 6,
}

function getLayer(filePath: string): string {
  const parts = filePath.split('/')
  const srcIdx = parts.indexOf('src')
  if (srcIdx < 0 || srcIdx + 1 >= parts.length) return 'other'
  return parts[srcIdx + 1]
}

function getExtension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function getFilename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function getDirname(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(0, slash) : ''
}

async function collectFiles(
  rootPath: string,
  maxFiles: number,
  onProgress?: (count: number) => void,
): Promise<string[]> {
  const platform = getPlatform()
  const found: string[] = []
  const queue: string[] = [rootPath]

  while (queue.length > 0 && found.length < maxFiles) {
    const dir = queue.shift()!
    let entries
    try {
      entries = await platform.fs.readDirectory(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory) {
        if (HIDDEN_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue
        queue.push(entry.path)
      } else {
        if (!PARSEABLE_EXTENSIONS.has(getExtension(entry.name))) continue
        if (found.length >= maxFiles) break
        found.push(entry.path)
        if (onProgress && found.length % 25 === 0) onProgress(found.length)
      }
    }
  }
  return found
}

function buildGraph(
  relFiles: string[],
  importsByFile: Map<string, string[]>,
  knownFiles: Set<string>,
): { adj: Map<string, Set<string>>; radj: Map<string, Set<string>> } {
  const adj = new Map<string, Set<string>>()
  const radj = new Map<string, Set<string>>()

  for (const f of relFiles) {
    adj.set(f, new Set())
    radj.set(f, new Set())
  }

  for (const [from, specifiers] of importsByFile) {
    const config = getConfigForFile(from)
    if (!config) continue
    for (const spec of specifiers) {
      const target = resolveImport(spec, from, knownFiles, config.id)
      if (!target || target === from) continue
      adj.get(from)!.add(target)
      radj.get(target)?.add(from)
    }
  }

  return { adj, radj }
}

function findCycles(adj: Map<string, Set<string>>): string[][] {
  const index = new Map<string, number>()
  const lowlink = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const sccs: string[][] = []
  let idx = 0

  function strongConnect(v: string) {
    index.set(v, idx)
    lowlink.set(v, idx)
    idx++
    stack.push(v)
    onStack.add(v)

    for (const w of adj.get(v) ?? []) {
      if (!index.has(w)) {
        strongConnect(w)
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!))
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!))
      }
    }

    if (lowlink.get(v) === index.get(v)) {
      const scc: string[] = []
      let w: string
      do {
        w = stack.pop()!
        onStack.delete(w)
        scc.push(w)
      } while (w !== v)
      if (scc.length > 1) sccs.push(scc)
    }
  }

  for (const v of adj.keys()) {
    if (!index.has(v)) strongConnect(v)
  }

  return sccs
}

function longestPathFrom(
  start: string,
  adj: Map<string, Set<string>>,
  memo: Map<string, number>,
  visiting: Set<string>,
): number {
  if (memo.has(start)) return memo.get(start)!
  if (visiting.has(start)) return 0
  visiting.add(start)

  let max = 0
  for (const next of adj.get(start) ?? []) {
    max = Math.max(max, 1 + longestPathFrom(next, adj, memo, visiting))
  }

  visiting.delete(start)
  memo.set(start, max)
  return max
}

function detectLayerViolations(
  adj: Map<string, Set<string>>,
): { from: string; to: string; fromLayer: string; toLayer: string }[] {
  const violations: { from: string; to: string; fromLayer: string; toLayer: string }[] = []

  for (const [from, targets] of adj) {
    const fromLayer = getLayer(from)
    const fromLevel = LAYER_ORDER[fromLayer]
    if (fromLevel === undefined) continue

    for (const to of targets) {
      const toLayer = getLayer(to)
      const toLevel = LAYER_ORDER[toLayer]
      if (toLevel === undefined) continue
      if (toLevel > fromLevel) {
        violations.push({ from, to, fromLayer, toLayer })
      }
    }
  }

  return violations
}

export function analyzeGraph(
  files: string[],
  edges: [string, string][],
  config: Partial<AnalysisConfig> = {},
  lineCounts?: Map<string, number>,
): AnalysisResult {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const findings: Finding[] = []

  const adj = new Map<string, Set<string>>()
  const radj = new Map<string, Set<string>>()
  for (const f of files) {
    adj.set(f, new Set())
    radj.set(f, new Set())
  }
  for (const [from, to] of edges) {
    adj.get(from)?.add(to)
    radj.get(to)?.add(from)
  }

  const cycles = findCycles(adj)
  for (const cycle of cycles) {
    findings.push({
      type: 'circular-dependency',
      severity: 'error',
      files: cycle,
      message: `Circular dependency: ${cycle.join(' → ')} → ${cycle[0]}`,
    })
  }

  const depthMemo = new Map<string, number>()
  const depthVisiting = new Set<string>()
  const metrics: FileMetrics[] = files.map((path) => {
    const inDegree = radj.get(path)?.size ?? 0
    const outDegree = adj.get(path)?.size ?? 0
    const depth = longestPathFrom(path, adj, depthMemo, depthVisiting)
    return {
      path,
      folder: getDirname(path),
      layer: getLayer(path),
      lineCount: lineCounts?.get(path) ?? 0,
      inDegree,
      outDegree,
      isTest: isTestFile(getFilename(path)),
      longestChainDepth: depth,
    }
  })

  for (const m of metrics) {
    if (m.isTest) continue

    if (m.inDegree >= cfg.fanInThreshold && m.outDegree >= cfg.fanOutThreshold) {
      findings.push({
        type: 'god-module',
        severity: 'error',
        files: [m.path],
        message: `God module: ${m.path} has ${m.inDegree} importers and imports ${m.outDegree} files`,
      })
    } else if (m.inDegree >= cfg.fanInThreshold) {
      findings.push({
        type: 'high-fan-in',
        severity: 'warning',
        files: [m.path],
        message: `High fan-in: ${m.path} is imported by ${m.inDegree} files`,
      })
    } else if (m.outDegree >= cfg.fanOutThreshold) {
      findings.push({
        type: 'high-fan-out',
        severity: 'warning',
        files: [m.path],
        message: `High fan-out: ${m.path} imports ${m.outDegree} files`,
      })
    }

    if (m.longestChainDepth >= cfg.depthThreshold) {
      findings.push({
        type: 'deep-chain',
        severity: 'warning',
        files: [m.path],
        message: `Deep dependency chain: ${m.path} has a transitive chain of depth ${m.longestChainDepth}`,
      })
    }
  }

  const entryPoints = new Set(['src/main.tsx', 'src/App.tsx'])
  for (const m of metrics) {
    if (m.isTest || entryPoints.has(m.path)) continue
    if (m.inDegree === 0) {
      findings.push({
        type: 'orphan',
        severity: 'info',
        files: [m.path],
        message: `Orphan: ${m.path} is not imported by any file`,
      })
    }
  }

  const violations = detectLayerViolations(adj)
  const violationGroups = new Map<string, string[]>()
  for (const v of violations) {
    const key = `${v.fromLayer}→${v.toLayer}`
    if (!violationGroups.has(key)) violationGroups.set(key, [])
    violationGroups.get(key)!.push(`${v.from} → ${v.to}`)
  }
  for (const [direction, imports] of violationGroups) {
    findings.push({
      type: 'layer-violation',
      severity: 'warning',
      files: imports.map((i) => i.split(' → ')[0]),
      message: `Layer violation (${direction}): ${imports.length} import(s) flow upward — ${imports.slice(0, 3).join(', ')}${imports.length > 3 ? ` (+${imports.length - 3} more)` : ''}`,
    })
  }

  const hubThreshold = Math.max(cfg.fanInThreshold * 0.6, 5)
  for (const m of metrics) {
    if (m.isTest || m.inDegree < hubThreshold) continue
    const importers = [...(radj.get(m.path) ?? [])]
    const importerLayers = new Set(importers.map(getLayer))
    if (importerLayers.size >= 3) {
      findings.push({
        type: 'hub-bottleneck',
        severity: 'info',
        files: [m.path],
        message: `Hub bottleneck: ${m.path} is imported from ${importerLayers.size} different layers (${[...importerLayers].join(', ')})`,
      })
    }
  }

  for (const m of metrics) {
    if (m.isTest) continue
    if (m.lineCount >= cfg.largeFileThreshold) {
      findings.push({
        type: 'large-file',
        severity: m.lineCount >= cfg.largeFileThreshold * 2 ? 'warning' : 'info',
        files: [m.path],
        message: `Large file: ${m.path} has ${m.lineCount} lines`,
      })
    }
  }

  const folderCounts = new Map<string, string[]>()
  for (const m of metrics) {
    if (!m.folder) continue
    if (!folderCounts.has(m.folder)) folderCounts.set(m.folder, [])
    folderCounts.get(m.folder)!.push(m.path)
  }
  for (const [folder, paths] of folderCounts) {
    if (paths.length >= cfg.wideFolderThreshold) {
      findings.push({
        type: 'wide-folder',
        severity: 'info',
        files: paths,
        message: `Wide folder: ${folder} has ${paths.length} files`,
      })
    }
  }

  const testFiles = new Set(metrics.filter((m) => m.isTest).map((m) => m.path))
  for (const m of metrics) {
    if (m.isTest || entryPoints.has(m.path)) continue
    const name = getFilename(m.path)
    const dotIdx = name.indexOf('.')
    if (dotIdx < 0) continue
    const base = name.slice(0, dotIdx)
    const hasTest =
      testFiles.has(`${m.folder}/${base}.test${name.slice(dotIdx)}`) ||
      testFiles.has(`${m.folder}/${base}.spec${name.slice(dotIdx)}`)
    if (!hasTest && m.outDegree > 2) {
      findings.push({
        type: 'missing-test',
        severity: 'info',
        files: [m.path],
        message: `Missing test: ${m.path} has no corresponding test file`,
      })
    }
  }

  for (const m of metrics) {
    if (m.isTest) continue
    const targets = adj.get(m.path)
    if (!targets || targets.size === 0) continue
    const importedLayers = new Set<string>()
    for (const t of targets) {
      const layer = getLayer(t)
      if (layer !== 'other') importedLayers.add(layer)
    }
    if (importedLayers.size >= cfg.mixedLayerThreshold) {
      findings.push({
        type: 'mixed-layers',
        severity: 'info',
        files: [m.path],
        message: `Mixed layers: ${m.path} imports from ${importedLayers.size} layers (${[...importedLayers].join(', ')})`,
      })
    }
  }

  findings.sort((a, b) => {
    const sev = { error: 0, warning: 1, info: 2 }
    return sev[a.severity] - sev[b.severity]
  })

  return { findings, metrics, graph: { nodes: files, edges: [...edges] } }
}

export async function analyzeStructure(
  rootPath: string,
  config: Partial<AnalysisConfig> = {},
  onProgress?: (stage: string, count: number) => void,
): Promise<AnalysisResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  onProgress?.('collecting', 0)
  const absFiles = await collectFiles(rootPath, cfg.maxFiles, (n) => onProgress?.('collecting', n))
  const relFiles = absFiles.map((p) => toRepoRelative(p, rootPath))
  const knownFiles = new Set(relFiles)

  onProgress?.('parsing', 0)
  const platform = getPlatform()
  const importsByFile = new Map<string, string[]>()
  const lineCounts = new Map<string, number>()
  let parsed = 0
  await Promise.all(
    absFiles.map(async (abs, i) => {
      const rel = relFiles[i]
      try {
        const source = await platform.fs.readFile(abs)
        lineCounts.set(rel, source.split('\n').length)
        importsByFile.set(rel, await parseImports(rel, source))
      } catch {
        importsByFile.set(rel, [])
      }
      parsed++
      if (parsed % 25 === 0) onProgress?.('parsing', parsed)
    }),
  )

  onProgress?.('analyzing', 0)
  const { adj } = buildGraph(relFiles, importsByFile, knownFiles)

  const edges: [string, string][] = []
  for (const [from, targets] of adj) {
    for (const to of targets) edges.push([from, to])
  }

  return analyzeGraph(relFiles, edges, config, lineCounts)
}
