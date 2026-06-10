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
