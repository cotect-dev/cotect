// Code samples for the live demos. The "review" demo tells a deliberate story:
// the agent was asked to add exponential backoff, and the diff also smuggles in
// a retry-count bump (hunk two) — exactly the kind of change cotect exists to
// catch.

export const DEMO_FILE_PATH = 'src/net/fetchWithRetry.ts'

export const DEMO_HEAD = `export interface RetryOptions {
  retries?: number
  baseDelayMs?: number
}

export async function fetchWithRetry(
  url: string,
  options: RetryOptions = {},
): Promise<Response> {
  const { retries = 3, baseDelayMs = 250 } = options
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(\`HTTP \${res.status}\`)
      return res
    } catch (err) {
      lastError = err
      await sleep(baseDelayMs * attempt)
    }
  }
  throw lastError
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
`

export const DEMO_AGENT = `export interface RetryOptions {
  retries?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

export async function fetchWithRetry(
  url: string,
  options: RetryOptions = {},
): Promise<Response> {
  const { retries = 5, baseDelayMs = 250, maxDelayMs = 30_000 } = options
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(\`HTTP \${res.status}\`)
      return res
    } catch (err) {
      lastError = err
      const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
      await sleep(cap / 2 + Math.random() * (cap / 2))
    }
  }
  throw lastError
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
`

export interface PolyglotTab {
  label: string
  file: string
  code: string
}

export const POLYGLOT_TABS: PolyglotTab[] = [
  {
    label: 'TypeScript',
    file: 'src/review/progress.ts',
    code: `export interface FileProgress {
  path: string
  reviewed: number
  total: number
}

export function overallProgress(files: FileProgress[]): number {
  const totals = files.reduce(
    (acc, f) => ({
      reviewed: acc.reviewed + f.reviewed,
      total: acc.total + f.total,
    }),
    { reviewed: 0, total: 0 },
  )
  if (totals.total === 0) return 1
  return totals.reviewed / totals.total
}
`,
  },
  {
    label: 'Rust',
    file: 'tauri/src/watcher.rs',
    code: `use std::path::PathBuf;

/// Drop events under ignored path components (node_modules, .git, …)
/// before they ever cross the IPC boundary.
pub fn filter_ignored(paths: Vec<PathBuf>, ignore: &[String]) -> Vec<PathBuf> {
    paths
        .into_iter()
        .filter(|path| {
            path.components().all(|component| {
                let name = component.as_os_str().to_string_lossy();
                !ignore.iter().any(|entry| name == entry.as_str())
            })
        })
        .collect()
}
`,
  },
  {
    label: 'Python',
    file: 'tools/triage.py',
    code: `from collections import defaultdict


def group_hunks_by_risk(hunks: list[dict]) -> dict[str, list[dict]]:
    """Bucket review hunks so the riskiest changes surface first."""
    buckets: dict[str, list[dict]] = defaultdict(list)
    for hunk in hunks:
        churn = hunk["added"] + hunk["removed"]
        if hunk["path"].endswith((".lock", ".snap")):
            buckets["generated"].append(hunk)
        elif churn > 40:
            buckets["needs-attention"].append(hunk)
        else:
            buckets["quick-read"].append(hunk)
    return dict(buckets)
`,
  },
  {
    label: 'Go',
    file: 'internal/diff/split.go',
    code: `package diff

// SplitHunks separates a unified diff into reviewable units,
// keeping context lines attached to the change they explain.
func SplitHunks(lines []Line) [][]Line {
	var hunks [][]Line
	var current []Line
	for _, line := range lines {
		if line.Kind == KindHeader && len(current) > 0 {
			hunks = append(hunks, current)
			current = nil
		}
		current = append(current, line)
	}
	if len(current) > 0 {
		hunks = append(hunks, current)
	}
	return hunks
}
`,
  },
]
