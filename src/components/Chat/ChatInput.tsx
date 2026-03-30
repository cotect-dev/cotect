import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useChatStore, sendMessage } from '@/store/chat'

export default function ChatInput() {
  const [text, setText] = useState('')
  const {
    isGenerating, abortController, thinkingEnabled,
    clearMessages, setThinkingEnabled, messages,
  } = useChatStore()
  const hasMessages = messages.length > 0

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || isGenerating) return
    setText('')
    sendMessage(trimmed)
  }, [text, isGenerating])

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
        <Tooltip>
          <TooltipTrigger render={
            <Button
              size="sm"
              variant={thinkingEnabled ? 'secondary' : 'ghost'}
              onClick={() => setThinkingEnabled(!thinkingEnabled)}
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
                onClick={clearMessages}
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
            onClick={() => abortController?.abort()}
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
}
