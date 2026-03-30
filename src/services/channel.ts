import type { PanelPosition } from '@/store/layout'

export type ChannelMessage =
  | { type: 'drag-start'; panelId: string; panelIds: string[]; sourceWindow: string }
  | { type: 'drag-end'; sourceWindow: string }
  | { type: 'drag-drop'; panelId: string; panelIds: string[]; targetWindow: string; position: PanelPosition; groupKey: string | null }
  | { type: 'window-opened'; windowId: string }
  | { type: 'window-closed'; windowId: string }

let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel {
  if (!channel) {
    channel = new BroadcastChannel('cotect')
  }
  return channel
}

export function broadcast(message: ChannelMessage): void {
  getChannel().postMessage(message)
}

export function onMessage(handler: (message: ChannelMessage) => void): () => void {
  const ch = getChannel()
  const listener = (event: MessageEvent<ChannelMessage>) => handler(event.data)
  ch.addEventListener('message', listener)
  return () => ch.removeEventListener('message', listener)
}

export function closeChannel(): void {
  if (channel) {
    channel.close()
    channel = null
  }
}
