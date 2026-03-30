import { filesystem } from '@neutralinojs/lib'
import type { PanelPosition } from '@/store/layout'

export type ChannelMessage =
  | { type: 'drag-start'; panelId: string; panelIds: string[]; sourceWindow: string }
  | { type: 'drag-end'; sourceWindow: string }
  | { type: 'drag-drop'; panelId: string; panelIds: string[]; targetWindow: string; position: PanelPosition; groupKey: string | null }
  | { type: 'window-opened'; windowId: string }
  | { type: 'window-closed'; windowId: string }

let senderId = ''
const handlers: ((msg: ChannelMessage) => void)[] = []

function isNeutralino(): boolean {
  return typeof window !== 'undefined' && !!window.NL_PORT
}

export function initChannel(windowId: string): void {
  senderId = windowId
  if (isNeutralino()) {
    startNeuPolling()
  }
}

// =============================================================================
// Neutralino: filesystem-based IPC at /tmp/cotect-ipc.json
// Outside project dir so the file watcher doesn't trigger reloads.
// =============================================================================

const IPC_FILE = '/tmp/cotect-ipc.json'
const MESSAGE_TTL = 5000
const POLL_INTERVAL = 100

interface IpcEnvelope {
  sender: string
  data: ChannelMessage
  ts: number
}

let lastSeenTs = Date.now()
let neuPollTimer: ReturnType<typeof setInterval> | null = null

async function neuReadEnvelopes(): Promise<IpcEnvelope[]> {
  try {
    const raw = await filesystem.readFile(IPC_FILE)
    return JSON.parse(raw)
  } catch {
    return []
  }
}

async function neuWriteEnvelopes(envelopes: IpcEnvelope[]): Promise<void> {
  await filesystem.writeFile(IPC_FILE, JSON.stringify(envelopes))
}

async function neuPoll(): Promise<void> {
  try {
    const envelopes = await neuReadEnvelopes()

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
  } catch {
    // file missing or unreadable — ignore
  }
}

async function neuBroadcast(message: ChannelMessage): Promise<void> {
  try {
    const now = Date.now()
    const envelopes = (await neuReadEnvelopes()).filter((e) => now - e.ts < MESSAGE_TTL)
    envelopes.push({ sender: senderId, data: message, ts: now })
    await neuWriteEnvelopes(envelopes)
  } catch (err) {
    console.error('[ipc] broadcast failed:', err)
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
}

// =============================================================================
// Browser: BroadcastChannel (works across tabs of the same origin)
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
