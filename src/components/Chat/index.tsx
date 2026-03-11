import { useEffect, useRef } from 'react'
import { useChatStore } from '../../store/chat'
import ChatMessage from './ChatMessage'
import ChatInput from './ChatInput'

export default function Chat() {
  const messages = useChatStore((s) => s.messages)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1">
        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-default-400 text-sm">
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
