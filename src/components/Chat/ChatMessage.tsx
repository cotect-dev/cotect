import { memo, useState, useMemo, useSyncExternalStore, lazy, Suspense } from 'react'
import type { Message } from '@/store/chat'

const ReactMarkdown = lazy(() => import('react-markdown'))

// PrismAsyncLight has a tiny core and lazy-loads each language on demand,
// instead of bundling refractor's entire language table (~1.6 MB).
type SyntaxHighlighterComponent =
  typeof import('react-syntax-highlighter/dist/esm/prism-async-light').default

let _remarkGfm: typeof import('remark-gfm').default | null = null
let _oneDark: Record<string, React.CSSProperties> | null = null
let _SyntaxHighlighter: SyntaxHighlighterComponent | null = null

let _loadVersion = 0
const _listeners = new Set<() => void>()
function subscribeModules(cb: () => void) {
  _listeners.add(cb)
  return () => _listeners.delete(cb)
}
function getModulesSnapshot() {
  return _loadVersion
}

void import('remark-gfm').then((m) => { _remarkGfm = m.default; _loadVersion++; _listeners.forEach((fn) => fn()) })
void import('react-syntax-highlighter/dist/esm/styles/prism/one-dark').then((m) => { _oneDark = m.default; _loadVersion++; _listeners.forEach((fn) => fn()) })
void import('react-syntax-highlighter/dist/esm/prism-async-light').then((m) => { _SyntaxHighlighter = m.default; _loadVersion++; _listeners.forEach((fn) => fn()) })

function MarkdownCode({ className: cn, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  const match = /language-(\w+)/.exec(cn || '')
  const code = String(children).replace(/\n$/, '')
  if (match && _SyntaxHighlighter && _oneDark) {
    const Highlighter = _SyntaxHighlighter
    return (
      <Highlighter
        style={_oneDark}
        language={match[1]}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: '0.375rem',
          fontSize: '0.75rem',
        }}
      >
        {code}
      </Highlighter>
    )
  }
  return (
    <code className="bg-accent rounded px-1 py-0.5 text-xs" {...props}>
      {children}
    </code>
  )
}

const markdownComponents = { code: MarkdownCode }

function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const modulesVersion = useSyncExternalStore(subscribeModules, getModulesSnapshot)
  // Recompute when modulesVersion bumps: the module globals (_remarkGfm etc.)
  // are mutated outside React, and the version tick is our "they changed" signal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plugins = useMemo(() => _remarkGfm ? [_remarkGfm] : [], [modulesVersion])

  return (
    <div className={`prose dark:prose-invert prose-sm max-w-none break-words [&_p]:my-1 [&_pre]:my-1 [&_ul]:my-1 [&_ol]:my-1 ${className}`}>
      <Suspense fallback={<StreamingText text={text} />}>
        <ReactMarkdown
          remarkPlugins={plugins}
          components={markdownComponents}
        >
          {text}
        </ReactMarkdown>
      </Suspense>
    </div>
  )
}

function StreamingText({ text }: { text: string }) {
  return (
    <div className="prose dark:prose-invert prose-sm max-w-none break-words [&_p]:my-1">
      <p className="whitespace-pre-wrap">{text}</p>
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
        aria-expanded={open}
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
          <div className="text-xs whitespace-pre-wrap opacity-75">{thinking}</div>
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
        ) : message.isStreaming ? (
          <StreamingText text={message.content} />
        ) : (
          <Markdown text={message.content} />
        )}
        {!isUser && <StreamStats message={message} />}
      </div>
    </div>
  )
})

export default ChatMessage
