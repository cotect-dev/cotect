import { memo, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useChatStore, sendMessage } from '@/store/chat'

export default memo(function ChatInput() {
  const [text, setText] = useState('')
  // Narrow selectors — only subscribe to the specific values we render.
  // Actions are accessed via getState() to avoid extra subscriptions.
  const isGenerating = useChatStore((s) => s.isGenerating)
  const thinkingEnabled = useChatStore((s) => s.thinkingEnabled)
  const hasMessages = useChatStore((s) => s.messages.length > 0)

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || useChatStore.getState().isGenerating) return
    setText('')
    sendMessage(trimmed)
  }, [text])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const handleToggleThinking = useCallback(() => {
    const store = useChatStore.getState()
    store.setThinkingEnabled(!store.thinkingEnabled)
  }, [])

  const handleClear = useCallback(() => {
    useChatStore.getState().clearMessages()
  }, [])

  const handleStop = useCallback(() => {
    useChatStore.getState().abortController?.abort()
  }, [])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1 items-center">
        <Tooltip>
          <TooltipTrigger render={
            <Button
              size="sm"
              variant={thinkingEnabled ? 'secondary' : 'ghost'}
              onClick={handleToggleThinking}
              className="min-w-0 px-2 text-xs"
            />
          }>
            {thinkingEnabled ? 'Think' : 'No think'}
          </TooltipTrigger>
          <TooltipContent>{thinkingEnabled ? 'Thinking enabled' : 'Thinking disabled'}</TooltipContent>
        </Tooltip>
        {hasMessages && (
          <Tooltip>
            <TooltipTrigger render={
              <Button
                size="sm"
                variant="destructive"
                onClick={handleClear}
                disabled={isGenerating}
                className="min-w-0 px-2 text-xs"
              />
            }>
              Clear
            </TooltipTrigger>
            <TooltipContent>Clear chat</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex gap-2 items-end">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          rows={1}
          className="flex-1 min-h-0 resize-none"
        />
        {isGenerating ? (
          <Button
            size="sm"
            variant="destructive"
            onClick={handleStop}
            className="shrink-0"
          >
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!text.trim()}
            className="shrink-0"
          >
            Send
          </Button>
        )}
      </div>
    </div>
  )
})
