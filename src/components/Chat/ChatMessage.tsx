import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { Message } from '../../store/chat'

function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`prose prose-invert prose-sm max-w-none break-words [&_p]:my-1 [&_pre]:my-1 [&_ul]:my-1 [&_ol]:my-1 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className: cn, children, ...props }) {
            const match = /language-(\w+)/.exec(cn || '')
            const code = String(children).replace(/\n$/, '')
            if (match) {
              return (
                <SyntaxHighlighter
                  style={oneDark}
                  language={match[1]}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    borderRadius: '0.375rem',
                    fontSize: '0.75rem',
                  }}
                >
                  {code}
                </SyntaxHighlighter>
              )
            }
            return (
              <code className="bg-accent rounded px-1 py-0.5 text-xs" {...props}>
                {children}
              </code>
            )
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

function ThinkingBlock({ message }: { message: Message }) {
  const { thinking, thinkingTokens, thinkingDurationMs = 0, isThinking } = message
  const [open, setOpen] = useState(false)

  if (!thinking) return null

  const label = isThinking
    ? `Thinking... ${formatDuration(thinkingDurationMs)} · ${thinkingTokens} tokens`
    : `Thought for ${formatDuration(thinkingDurationMs)} · ${thinkingTokens} tokens`

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
      >
        <span
          className="transition-transform text-[0.5rem]"
          style={{ transform: open ? 'rotate(90deg)' : undefined }}
        >
          ▶
        </span>
        {isThinking && (
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        )}
        {label}
      </button>
      {open && (
        <div className="pl-2 border-l-2 border-border text-muted-foreground max-h-64 overflow-y-auto">
          {isThinking ? (
            <div className="text-xs whitespace-pre-wrap opacity-75">{thinking}</div>
          ) : (
            <Markdown
              text={thinking}
              className="!prose-xs opacity-75 [&_p]:text-xs [&_li]:text-xs [&_code]:text-[0.65rem]"
            />
          )}
        </div>
      )}
    </div>
  )
}

function StreamStats({ message }: { message: Message }) {
  const { totalTokens = 0, durationMs = 0, isStreaming, model } = message
  if (!totalTokens && !isStreaming) return null

  const seconds = durationMs / 1000
  const tokPerSec = seconds > 0 ? (totalTokens / seconds).toFixed(1) : '—'

  return (
    <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground font-mono">
      {model && <span className="text-muted-foreground/70">{model}</span>}
      <span>{totalTokens} tok</span>
      <span>{formatDuration(durationMs)}</span>
      <span className="text-foreground/60 font-semibold">{tokPerSec} tok/s</span>
      {isStreaming && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
      )}
    </div>
  )
}

const ChatMessage = memo(function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-xl px-3 py-2 ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground'
        }`}
      >
        {!isUser && <ThinkingBlock message={message} />}
        {message.isStreaming && !message.content ? (
          <span className="text-sm text-muted-foreground">...</span>
        ) : (
          <Markdown text={message.content} />
        )}
        {!isUser && <StreamStats message={message} />}
      </div>
    </div>
  )
})

export default ChatMessage
