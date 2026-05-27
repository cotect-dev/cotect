import type { GitLogEntry } from '@/store/git'
import type { FileMetrics } from '@/services/structureAnalyzer'

export interface FileChurn {
  path: string
  commitCount: number
  totalInsertions: number
  totalDeletions: number
  lastModified: number
}

export interface ChangeCoupling {
  fileA: string
  fileB: string
  coChangeCount: number
  couplingStrength: number
}

export interface Hotspot {
  path: string
  churnScore: number
  fanIn: number
  hotspotScore: number
}

export function computeChurn(log: GitLogEntry[], knownFiles: Set<string>): FileChurn[] {
  const map = new Map<string, FileChurn>()

  for (const entry of log) {
    for (const file of entry.files) {
      if (!knownFiles.has(file.path)) continue
      let churn = map.get(file.path)
      if (!churn) {
        churn = {
          path: file.path,
          commitCount: 0,
          totalInsertions: 0,
          totalDeletions: 0,
          lastModified: 0,
        }
        map.set(file.path, churn)
      }
      churn.commitCount++
      churn.totalInsertions += file.insertions
      churn.totalDeletions += file.deletions
      if (entry.timestamp > churn.lastModified) {
        churn.lastModified = entry.timestamp
      }
    }
  }

  return [...map.values()].sort((a, b) => b.commitCount - a.commitCount)
}

export function computeChangeCoupling(
  log: GitLogEntry[],
  knownFiles: Set<string>,
  minCoChanges: number = 3,
): ChangeCoupling[] {
  const pairCounts = new Map<string, number>()
  const fileCounts = new Map<string, number>()

  for (const entry of log) {
    const files = entry.files.map((f) => f.path).filter((p) => knownFiles.has(p))
    for (const f of files) {
      fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1)
    }
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const key = files[i] < files[j] ? `${files[i]}\0${files[j]}` : `${files[j]}\0${files[i]}`
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
      }
    }
  }

  const results: ChangeCoupling[] = []
  for (const [key, count] of pairCounts) {
    if (count < minCoChanges) continue
    const [fileA, fileB] = key.split('\0')
    const maxCount = Math.max(fileCounts.get(fileA) ?? 1, fileCounts.get(fileB) ?? 1)
    results.push({
      fileA,
      fileB,
      coChangeCount: count,
      couplingStrength: count / maxCount,
    })
  }

  return results.sort((a, b) => b.coChangeCount - a.coChangeCount)
}

export function computeHotspots(
  churn: FileChurn[],
  metrics: FileMetrics[],
  fanInThreshold: number = 5,
): Hotspot[] {
  if (churn.length === 0 || metrics.length === 0) return []

  const maxChurn = Math.max(...churn.map((c) => c.commitCount))
  if (maxChurn === 0) return []

  const churnMap = new Map(churn.map((c) => [c.path, c]))
  const fanInValues = metrics.filter((m) => !m.isTest).map((m) => m.inDegree)
  const maxFanIn = Math.max(...fanInValues, 1)

  const churnThreshold = maxChurn * 0.2

  const hotspots: Hotspot[] = []
  for (const m of metrics) {
    if (m.isTest) continue
    if (m.inDegree < fanInThreshold) continue
    const c = churnMap.get(m.path)
    if (!c || c.commitCount < churnThreshold) continue

    const normalizedChurn = c.commitCount / maxChurn
    const normalizedFanIn = m.inDegree / maxFanIn
    hotspots.push({
      path: m.path,
      churnScore: normalizedChurn,
      fanIn: m.inDegree,
      hotspotScore: normalizedChurn * normalizedFanIn,
    })
  }

  return hotspots.sort((a, b) => b.hotspotScore - a.hotspotScore)
}
