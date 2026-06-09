import type { FileMetrics } from '@/services/structureAnalyzer'

/** Default reference context window (tokens). Field moves fast — tune here. */
export const DEFAULT_CONTEXT_WINDOW = 200_000
/** A file above this estimated token size is flagged as hard to edit reliably with an LLM. */
export const LLM_RISK_TOKEN_THRESHOLD = 8_000

/** Rough token estimate: ~4 chars/token (a serviceable heuristic for source code). */
export function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / 4)
}

export interface FileSizeInfo {
  path: string
  lineCount: number
  tokens: number
  contextFraction: number // tokens / contextWindow
  isRisky: boolean
}

export function computeFileSizes(
  metrics: FileMetrics[],
  charCounts: Map<string, number>,
  contextWindow: number = DEFAULT_CONTEXT_WINDOW,
  riskThreshold: number = LLM_RISK_TOKEN_THRESHOLD,
): FileSizeInfo[] {
  const result: FileSizeInfo[] = []
  for (const m of metrics) {
    if (m.isTest) continue
    const tokens = estimateTokens(charCounts.get(m.path) ?? 0)
    if (tokens === 0) continue
    result.push({
      path: m.path,
      lineCount: m.lineCount,
      tokens,
      contextFraction: tokens / contextWindow,
      isRisky: tokens >= riskThreshold,
    })
  }
  return result.sort((a, b) => b.tokens - a.tokens)
}
