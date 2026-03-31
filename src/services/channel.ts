import { filesystem } from '@neutralinojs/lib'
import { isNeutralino } from '@/services/platform'
import { readJson, writeJsonSync } from '@/services/storage'
import type { PanelPosition } from '@/store/layout'

export type ChannelMessage =
  | { type: 'drag-start'; panelId: string; panelIds: string[]; sourceWindow: string }
  | { type: 'drag-end'; sourceWindow: string }
  | { type: 'drag-move'; screenX: number; screenY: number; sourceWindow: string }
  | { type: 'drag-drop'; panelId: string; panelIds: string[]; targetWindow: string; focusedAt: number; position: PanelPosition; groupKey: string | null }
  | { type: 'window-opened'; windowId: string }
  | { type: 'window-closed'; windowId: string }

let senderId = ''
const handlers: ((msg: ChannelMessage) => void)[] = []

export function initChannel(windowId: string): void {
  senderId = windowId
  if (isNeutralino()) {
    startNeuPolling()
  }
}

// =============================================================================
// Neutralino: per-sender filesystem IPC (no write contention)
// =============================================================================

const IPC_PREFIX = 'ipc-'
const IPC_POS_FILE = '/tmp/cotect-drag-pos.json'
const MESSAGE_TTL = 5000
const POLL_INTERVAL = 100
const POS_POLL_INTERVAL = 30

interface IpcEnvelope {
  sender: string
  data: ChannelMessage
  ts: number
}

interface DragPos {
  sender: string
  screenX: number
  screenY: number
  ts: number
}

let lastSeenTs = Date.now()
let neuPollTimer: ReturnType<typeof setInterval> | null = null
let posPollTimer: ReturnType<typeof setInterval> | null = null
let lastPosTs = Date.now()

async function readSenderEnvelopes(senderKey: string): Promise<IpcEnvelope[]> {
  const data = await readJson<IpcEnvelope[]>(senderKey)
  return data ?? []
}

async function neuPoll(): Promise<void> {
  try {
    const entries = await filesystem.readDirectory('/tmp')
    const prefix = 'cotect-ipc-'
    const now = Date.now()

    for (const entry of entries) {
      if (entry.type !== 'FILE' || !entry.entry.startsWith(prefix) || !entry.entry.endsWith('.json')) continue
      const senderKey = entry.entry.slice('cotect-'.length, -5)
      const senderName = senderKey.slice(IPC_PREFIX.length)
      if (senderName === senderId) continue

      const envelopes = await readSenderEnvelopes(senderKey)
      for (const env of envelopes) {
        if (env.ts > lastSeenTs && now - env.ts < MESSAGE_TTL) {
          if (env.data.type === 'drag-start') startPosPolling()
          else if (env.data.type === 'drag-end') stopPosPolling()
          for (const handler of handlers) handler(env.data)
        }
      }
    }

    lastSeenTs = now
  } catch {
    // polling failure — will retry next interval
  }
}

async function posPoll(): Promise<void> {
  try {
    const raw = await filesystem.readFile(IPC_POS_FILE)
    const pos: DragPos = JSON.parse(raw)
    if (pos.sender !== senderId && pos.ts > lastPosTs) {
      lastPosTs = pos.ts
      for (const handler of handlers) {
        handler({ type: 'drag-move', screenX: pos.screenX, screenY: pos.screenY, sourceWindow: pos.sender })
      }
    }
  } catch {
    // file missing — no position yet
  }
}

async function neuBroadcast(message: ChannelMessage): Promise<void> {
  if (message.type === 'drag-move') {
    try {
      const pos: DragPos = { sender: senderId, screenX: message.screenX, screenY: message.screenY, ts: Date.now() }
      await filesystem.writeFile(IPC_POS_FILE, JSON.stringify(pos))
    } catch {
      console.warn('[ipc] Failed to write drag position')
    }
    return
  }

  const key = `${IPC_PREFIX}${senderId}`
  const now = Date.now()
  const existing = await readSenderEnvelopes(key)
  const fresh = existing.filter((e) => now - e.ts < MESSAGE_TTL)
  fresh.push({ sender: senderId, data: message, ts: now })
  writeJsonSync(key, fresh)
}

function startNeuPolling(): void {
  if (neuPollTimer) return
  neuPollTimer = setInterval(neuPoll, POLL_INTERVAL)
}

function stopNeuPolling(): void {
  if (neuPollTimer) {
    clearInterval(neuPollTimer)
    neuPollTimer = null
  }
  stopPosPolling()
}

function startPosPolling(): void {
  if (posPollTimer) return
  posPollTimer = setInterval(posPoll, POS_POLL_INTERVAL)
}

function stopPosPolling(): void {
  if (posPollTimer) {
    clearInterval(posPollTimer)
    posPollTimer = null
  }
}

// =============================================================================
// Browser: BroadcastChannel
// =============================================================================

let bcChannel: BroadcastChannel | null = null

function getBcChannel(): BroadcastChannel {
  if (!bcChannel) {
    bcChannel = new BroadcastChannel('cotect')
    bcChannel.addEventListener('message', (event: MessageEvent<ChannelMessage>) => {
      for (const handler of handlers) handler(event.data)
    })
  }
  return bcChannel
}

// =============================================================================
// Public API
// =============================================================================

export async function broadcast(message: ChannelMessage): Promise<void> {
  if (isNeutralino()) {
    await neuBroadcast(message)
  } else {
    getBcChannel().postMessage(message)
  }
}

export function onMessage(handler: (message: ChannelMessage) => void): () => void {
  handlers.push(handler)
  if (!isNeutralino()) getBcChannel()
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
