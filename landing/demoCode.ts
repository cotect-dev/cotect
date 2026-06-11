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

// Sources for every other file node on the demo canvas, keyed by repo-relative
// path. Browsing them with WASD opens read-only head views; imports mirror the
// edges in GRAPH_EDGES so the canvas, graph and health demos agree.
export const DEMO_FILE_CONTENTS: Record<string, string> = {
  'package.json': `{
  "name": "relay",
  "version": "0.4.2",
  "private": true,
  "scripts": {
    "dev": "tsx src/index.ts",
    "test": "vitest run"
  }
}
`,
  'README.md': `# relay

A small message relay. Accepts webhooks, queues them, and forwards
each one with retries.

## Run

\`\`\`sh
yarn dev
\`\`\`
`,
  'src/index.ts': `import { createClient } from './api/client'
import { registerRoutes } from './api/routes'
import { loadConfig } from './lib/config'
import { log } from './lib/log'

const config = loadConfig()
const client = createClient(config)

registerRoutes(client)
log.info('relay listening', { port: config.port })
`,
  'src/api/client.ts': `import { fetchWithRetry } from '../net/fetchWithRetry'
import { request } from '../net/http'
import { log } from '../lib/log'
import { createQueue } from '../lib/queue'
import { routeFor } from './routes'
import type { Config } from '../lib/config'

export function createClient(config: Config) {
  const queue = createQueue(config.queueLimit)

  async function deliver(payload: unknown): Promise<void> {
    const route = routeFor(payload)
    const res = await fetchWithRetry(route.url)
    if (!res.ok) {
      log.warn('delivery failed, requeueing', { route: route.name })
      queue.push(payload)
      return
    }
    await request(route.ackUrl, { method: 'POST' })
  }

  return { deliver, queue }
}
`,
  'src/api/routes.ts': `import type { createClient } from './client'
import { log } from '../lib/log'

const routes = [
  { name: 'orders', url: '/hooks/orders', ackUrl: '/ack/orders' },
  { name: 'billing', url: '/hooks/billing', ackUrl: '/ack/billing' },
]

export function routeFor(payload: unknown) {
  return routes[0]
}

export function registerRoutes(client: ReturnType<typeof createClient>) {
  log.info('routes registered', { count: routes.length })
}
`,
  'src/api/client.test.ts': `import { describe, it, expect } from 'vitest'
import { createClient } from './client'

describe('createClient', () => {
  it('queues failed deliveries', async () => {
    const client = createClient({ port: 0, queueLimit: 8 })
    await client.deliver({ id: 1 })
    expect(client.queue.size()).toBeGreaterThanOrEqual(0)
  })
})
`,
  'src/lib/config.ts': `import { QUEUE_DEFAULTS } from './queue'

export interface Config {
  port: number
  queueLimit: number
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 8080),
    queueLimit: QUEUE_DEFAULTS.limit,
  }
}
`,
  'src/lib/log.ts': `type Fields = Record<string, unknown>

function line(level: string, msg: string, fields?: Fields) {
  process.stdout.write(JSON.stringify({ level, msg, ...fields }) + '\\n')
}

export const log = {
  info: (msg: string, fields?: Fields) => line('info', msg, fields),
  warn: (msg: string, fields?: Fields) => line('warn', msg, fields),
  error: (msg: string, fields?: Fields) => line('error', msg, fields),
}
`,
  'src/lib/queue.ts': `export const QUEUE_DEFAULTS = { limit: 256 }

export function createQueue<T>(limit = QUEUE_DEFAULTS.limit) {
  const items: T[] = []

  return {
    push(item: T) {
      if (items.length >= limit) items.shift()
      items.push(item)
    },
    drain(): T[] {
      return items.splice(0, items.length)
    },
    size: () => items.length,
  }
}
`,
  'src/net/backoff.ts': `/** Capped exponential backoff with full jitter. */
export function backoffDelay(attempt: number, baseMs: number, capMs: number): number {
  const exp = Math.min(capMs, baseMs * 2 ** attempt)
  return exp / 2 + Math.random() * (exp / 2)
}
`,
  'src/net/http.ts': `import { log } from '../lib/log'

export interface RequestOptions {
  method?: string
  body?: string
  timeoutMs?: number
}

export async function request(url: string, options: RequestOptions = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000)
  try {
    return await fetch(url, {
      method: options.method ?? 'GET',
      body: options.body,
      signal: controller.signal,
    })
  } catch (err) {
    log.warn('request failed', { url })
    throw err
  } finally {
    clearTimeout(timer)
  }
}
`,
  'src/net/fetchWithRetry.test.ts': `import { describe, it, expect, vi } from 'vitest'
import { fetchWithRetry } from './fetchWithRetry'

describe('fetchWithRetry', () => {
  it('returns the first successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')))
    const res = await fetchWithRetry('/hooks/orders')
    expect(res.ok).toBe(true)
  })
})
`,
}

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
