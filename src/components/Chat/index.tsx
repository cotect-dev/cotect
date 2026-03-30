import { useEffect, useRef } from 'react'
import { useChatStore } from '@/store/chat'
import { loadPanelState, savePanelState } from '@/services/panelState'
import ChatMessage from './ChatMessage'
import ChatInput from './ChatInput'

interface ChatSavedState {
  messages: typeof useChatStore extends { getState: () => infer S } ? S['messages'] : never
  thinkingEnabled: boolean
}

export default function Chat() {
  const messages = useChatStore((s) => s.messages)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Sync panel state across windows
  useEffect(() => {
    loadPanelState<ChatSavedState>('chat').then((saved) => {
      if (saved?.messages) {
        useChatStore.setState({ messages: saved.messages, thinkingEnabled: saved.thinkingEnabled })
      }
    })

    let timer: ReturnType<typeof setTimeout> | null = null
    const unsub = useChatStore.subscribe(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const { messages, thinkingEnabled } = useChatStore.getState()
        savePanelState('chat', { messages, thinkingEnabled })
      }, 300)
    })

    return () => {
      unsub()
      if (timer) clearTimeout(timer)
      const { messages, thinkingEnabled } = useChatStore.getState()
      savePanelState('chat', { messages, thinkingEnabled })
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1">
        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Start a conversation
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
      <ChatInput />
    </div>
  )
}
