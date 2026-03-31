import { filesystem } from '@neutralinojs/lib'
import { isNeutralino } from '@/services/platform'
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
// Neutralino: filesystem-based IPC at /tmp/
// =============================================================================

const IPC_FILE = '/tmp/cotect-ipc.json'
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

async function neuReadEnvelopes(): Promise<IpcEnvelope[]> {
  try {
    const raw = await filesystem.readFile(IPC_FILE)
    return JSON.parse(raw)
  } catch {
    return []
  }
}

async function neuPoll(): Promise<void> {
  try {
    const envelopes = await neuReadEnvelopes()

    for (const env of envelopes) {
      if (env.sender !== senderId && env.ts > lastSeenTs) {
        if (env.data.type === 'drag-start') {
          startPosPolling()
        } else if (env.data.type === 'drag-end') {
          stopPosPolling()
        }
        for (const handler of handlers) {
          handler(env.data)
        }
      }
    }

    if (envelopes.length > 0) {
      lastSeenTs = Math.max(...envelopes.map((e) => e.ts), lastSeenTs)
    }
  } catch {
    // file missing or unreadable
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

  try {
    const now = Date.now()
    const envelopes = (await neuReadEnvelopes()).filter((e) => now - e.ts < MESSAGE_TTL)
    envelopes.push({ sender: senderId, data: message, ts: now })
    await filesystem.writeFile(IPC_FILE, JSON.stringify(envelopes))
  } catch (err) {
    console.warn('[ipc] broadcast failed:', err)
  }
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
