import type { PanelPosition } from '@/store/layout'

export type ChannelMessage =
  | { type: 'drag-start'; panelId: string; panelIds: string[]; sourceWindow: string }
  | { type: 'drag-end'; sourceWindow: string }
  | { type: 'drag-drop'; panelId: string; panelIds: string[]; targetWindow: string; position: PanelPosition; groupKey: string | null }
  | { type: 'window-opened'; windowId: string }
  | { type: 'window-closed'; windowId: string }

// --- Shared state ---
let senderId = ''
const handlers: ((msg: ChannelMessage) => void)[] = []

export function initChannel(windowId: string): void {
  senderId = windowId
  startPolling()
}

// =============================================================================
// localStorage-based IPC
//
// Works across separate webview processes as long as they share the same origin.
// Each message is stored with a sender ID and timestamp. Windows poll for new
// messages from other senders. Old messages are pruned automatically.
// =============================================================================

const IPC_KEY = 'cotect:ipc'
const MESSAGE_TTL = 5000
const POLL_INTERVAL = 100

interface IpcEnvelope {
  sender: string
  data: ChannelMessage
  ts: number
}

let lastSeenTs = Date.now()
let pollTimer: ReturnType<typeof setInterval> | null = null

function readEnvelopes(): IpcEnvelope[] {
  try {
    return JSON.parse(localStorage.getItem(IPC_KEY) ?? '[]')
  } catch {
    return []
  }
}

function writeEnvelopes(envelopes: IpcEnvelope[]): void {
  localStorage.setItem(IPC_KEY, JSON.stringify(envelopes))
}

function poll(): void {
  const envelopes = readEnvelopes()

  for (const env of envelopes) {
    if (env.sender !== senderId && env.ts > lastSeenTs) {
      for (const handler of handlers) {
        handler(env.data)
      }
    }
  }

  if (envelopes.length > 0) {
    lastSeenTs = Math.max(...envelopes.map((e) => e.ts), lastSeenTs)
  }
}

function startPolling(): void {
  if (pollTimer) return
  pollTimer = setInterval(poll, POLL_INTERVAL)
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

// =============================================================================
// Public API
// =============================================================================

export function broadcast(message: ChannelMessage): void {
  const now = Date.now()
  const envelopes = readEnvelopes().filter((e) => now - e.ts < MESSAGE_TTL)
  envelopes.push({ sender: senderId, data: message, ts: now })
  writeEnvelopes(envelopes)
}

export function onMessage(handler: (message: ChannelMessage) => void): () => void {
  handlers.push(handler)
  return () => {
    const idx = handlers.indexOf(handler)
    if (idx >= 0) handlers.splice(idx, 1)
  }
}

export function closeChannel(): void {
  stopPolling()
  handlers.length = 0
}
