import { useState, useCallback } from 'react'
import { Button, Textarea, Tooltip } from '@heroui/react'
import { useChatStore, sendMessage } from '../../store/chat'

export default function ChatInput() {
  const [text, setText] = useState('')
  const isGenerating = useChatStore((s) => s.isGenerating)
  const abortController = useChatStore((s) => s.abortController)
  const thinkingEnabled = useChatStore((s) => s.thinkingEnabled)
  const clearMessages = useChatStore((s) => s.clearMessages)
  const setThinkingEnabled = useChatStore((s) => s.setThinkingEnabled)
  const hasMessages = useChatStore((s) => s.messages.length > 0)

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || isGenerating) return
    setText('')
    sendMessage(trimmed)
  }, [text, isGenerating])

  const handleStop = useCallback(() => {
    abortController?.abort()
  }, [abortController])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1 items-center">
        <Tooltip content={thinkingEnabled ? 'Thinking enabled' : 'Thinking disabled'} size="sm">
          <Button
            size="sm"
            variant={thinkingEnabled ? 'flat' : 'light'}
            color={thinkingEnabled ? 'primary' : 'default'}
            onPress={() => setThinkingEnabled(!thinkingEnabled)}
            className="min-w-0 px-2 text-xs"
          >
            {thinkingEnabled ? 'Think' : 'No think'}
          </Button>
        </Tooltip>
        {hasMessages && (
          <Tooltip content="Clear chat" size="sm">
            <Button
              size="sm"
              variant="light"
              color="danger"
              onPress={clearMessages}
              isDisabled={isGenerating}
              className="min-w-0 px-2 text-xs"
            >
              Clear
            </Button>
          </Tooltip>
        )}
      </div>
      <div className="flex gap-2 items-end">
        <Textarea
          value={text}
          onValueChange={setText}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          minRows={1}
          maxRows={6}
          classNames={{
            inputWrapper: 'bg-default-50',
          }}
          className="flex-1"
        />
        {isGenerating ? (
          <Button
            size="sm"
            color="danger"
            variant="flat"
            onPress={handleStop}
            className="shrink-0"
          >
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            color="primary"
            onPress={handleSend}
            isDisabled={!text.trim()}
            className="shrink-0"
          >
            Send
          </Button>
        )}
      </div>
    </div>
  )
}
