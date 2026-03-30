import { storage } from '@neutralinojs/lib'
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
  if (isNeutralino()) {
    console.log('[ipc] init channel for', windowId, '(neutralino mode, polling)')
    startNeuPolling()
  } else {
    console.log('[ipc] init channel for', windowId, '(browser mode, BroadcastChannel)')
  }
}

function isNeutralino(): boolean {
  return typeof window !== 'undefined' && !!window.NL_PORT
}

// =============================================================================
// Browser: BroadcastChannel
// =============================================================================
let bcChannel: BroadcastChannel | null = null

function getBcChannel(): BroadcastChannel {
  if (!bcChannel) {
    bcChannel = new BroadcastChannel('cotect')
    bcChannel.addEventListener('message', (event: MessageEvent<ChannelMessage>) => {
      for (const handler of handlers) {
        handler(event.data)
      }
    })
  }
  return bcChannel
}

// =============================================================================
// Neutralino: storage-based polling
// =============================================================================
const IPC_KEY = 'ipc_channel'
const MESSAGE_TTL = 5000 // ms — messages older than this are pruned
const POLL_INTERVAL = 100 // ms

interface IpcEnvelope {
  sender: string
  data: ChannelMessage
  ts: number
}

let lastSeenTs = Date.now()
let pollTimer: ReturnType<typeof setInterval> | null = null

async function neuBroadcast(message: ChannelMessage): Promise<void> {
  try {
    let envelopes: IpcEnvelope[] = []
    try {
      const raw = await storage.getData(IPC_KEY)
      envelopes = JSON.parse(raw)
    } catch {
      // key doesn't exist yet or invalid JSON
    }

    const now = Date.now()
    // Prune old messages and append new one
    envelopes = envelopes.filter((e) => now - e.ts < MESSAGE_TTL)
    envelopes.push({ sender: senderId, data: message, ts: now })

    await storage.setData(IPC_KEY, JSON.stringify(envelopes))
    console.log('[ipc] broadcast:', message.type, 'from', senderId)
  } catch (err) {
    console.error('[ipc] broadcast failed:', err)
  }
}

async function neuPoll(): Promise<void> {
  try {
    const raw = await storage.getData(IPC_KEY)
    const envelopes: IpcEnvelope[] = JSON.parse(raw)

    for (const env of envelopes) {
      if (env.sender !== senderId && env.ts > lastSeenTs) {
        console.log('[ipc] received:', env.data.type, 'from', env.sender)
        for (const handler of handlers) {
          handler(env.data)
        }
      }
    }

    // Advance watermark
    if (envelopes.length > 0) {
      const maxTs = envelopes.reduce((m, e) => Math.max(m, e.ts), lastSeenTs)
      lastSeenTs = maxTs
    }
  } catch {
    // storage key missing or invalid — ignore
  }
}

function startNeuPolling(): void {
  if (pollTimer) return
  pollTimer = setInterval(neuPoll, POLL_INTERVAL)
}

function stopNeuPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

// =============================================================================
// Public API
// =============================================================================

export function broadcast(message: ChannelMessage): void {
  if (isNeutralino()) {
    neuBroadcast(message)
  } else {
    getBcChannel().postMessage(message)
  }
}

export function onMessage(handler: (message: ChannelMessage) => void): () => void {
  handlers.push(handler)

  // In browser mode, ensure BroadcastChannel is initialized
  if (!isNeutralino()) {
    getBcChannel()
  }

  return () => {
    const idx = handlers.indexOf(handler)
    if (idx >= 0) handlers.splice(idx, 1)
  }
}

export function closeChannel(): void {
  if (isNeutralino()) {
    stopNeuPolling()
  } else if (bcChannel) {
    bcChannel.close()
    bcChannel = null
  }
  handlers.length = 0
}
