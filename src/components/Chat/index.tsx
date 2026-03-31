import { useChatStore } from '@/store/chat'
import ChatMessage from './ChatMessage'
import ChatInput from './ChatInput'
import { useScrollToBottom } from '@/hooks/useScrollToBottom'

export default function Chat() {
  const messages = useChatStore((s) => s.messages)
  const bottomRef = useScrollToBottom(messages.length)

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
