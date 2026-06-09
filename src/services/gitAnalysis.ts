import type { GitLogEntry } from '@/store/git'
import type { FileMetrics } from '@/services/structureAnalyzer'

export interface FileChurn {
  path: string
  commitCount: number
  totalInsertions: number
  totalDeletions: number
  lastModified: number
}

export interface Hotspot {
  path: string
  commitCount: number
  lineCount: number
  inDegree: number // shown in the "why" line, not part of the score
  churnScore: number // normalized 0..1
  sizeScore: number // normalized 0..1
  hotspotScore: number // churnScore * sizeScore
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

export function computeHotspots(churn: FileChurn[], metrics: FileMetrics[]): Hotspot[] {
  if (churn.length === 0 || metrics.length === 0) return []

  const maxChurn = Math.max(...churn.map((c) => c.commitCount))
  if (maxChurn === 0) return []

  const nonTest = metrics.filter((m) => !m.isTest)
  const maxLines = Math.max(...nonTest.map((m) => m.lineCount), 1)
  const churnMap = new Map(churn.map((c) => [c.path, c]))

  const hotspots: Hotspot[] = []
  for (const m of nonTest) {
    const c = churnMap.get(m.path)
    if (!c || c.commitCount < 2 || m.lineCount <= 0) continue

    const churnScore = c.commitCount / maxChurn
    const sizeScore = m.lineCount / maxLines
    const hotspotScore = churnScore * sizeScore
    if (hotspotScore === 0) continue

    hotspots.push({
      path: m.path,
      commitCount: c.commitCount,
      lineCount: m.lineCount,
      inDegree: m.inDegree,
      churnScore,
      sizeScore,
      hotspotScore,
    })
  }

  return hotspots.sort((a, b) => b.hotspotScore - a.hotspotScore)
}
