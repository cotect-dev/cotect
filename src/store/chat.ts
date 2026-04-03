import { createSyncedStore } from './synced'
import { createStoreWithHMR } from '@/lib/hmr'

export type ModelId = 'qwen3.5-think' | 'qwen3.5-no-think'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  thinkingTokens?: number
  thinkingDurationMs?: number
  isThinking?: boolean
  isStreaming?: boolean
  totalTokens?: number
  durationMs?: number
  model?: ModelId
}

interface ChatState {
  messages: Message[]
  isGenerating: boolean
  thinkingEnabled: boolean
  abortController: AbortController | null
  addMessage: (msg: Message) => void
  updateMessage: (id: string, update: Partial<Message>) => void
  setGenerating: (v: boolean) => void
  setThinkingEnabled: (v: boolean) => void
  setAbortController: (c: AbortController | null) => void
  clearMessages: () => void
}

export const useChatStore = createStoreWithHMR(import.meta.hot, 'chat', () => createSyncedStore<ChatState>('chat', (set) => ({
  messages: [],
  isGenerating: false,
  thinkingEnabled: true,
  abortController: null,
  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),
  updateMessage: (id, update) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, ...update } : m,
      ),
    })),
  setGenerating: (isGenerating) => set({ isGenerating }),
  setThinkingEnabled: (thinkingEnabled) => set({ thinkingEnabled }),
  setAbortController: (abortController) => set({ abortController }),
  clearMessages: () => set({ messages: [] }),
}), {
  sanitize: (saved) => ({
    ...saved,
    isGenerating: false,
    abortController: null,
    messages: (saved as Partial<ChatState>).messages?.map((m) => ({
      ...m,
      isStreaming: false,
      isThinking: false,
    })),
  }),
}))

const API_BASE = '/llm/v1'

/** @internal Exported for testing only. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

export interface StreamAccumulator {
  content: string
  thinking: string
  rawStream: string
  inThinkTag: boolean
  thinkingTokens: number
  thinkingStartTime: number | null
  totalTokens: number
  streamStartTime: number | null
}

/** @internal Exported for testing only. */
export function createAccumulator(): StreamAccumulator {
  return { content: '', thinking: '', rawStream: '', inThinkTag: false, thinkingTokens: 0, thinkingStartTime: null, totalTokens: 0, streamStartTime: null }
}

/** @internal Exported for testing only. */
export function buildRequestPayload(messages: Message[], model: ModelId, thinkingEnabled: boolean) {
  const chatMessages = messages
    .filter((m) => !m.isStreaming)
    .map((m) => ({ role: m.role, content: m.content }))

  return {
    model,
    messages: [
      { role: 'system', content: `You are a helpful assistant.${thinkingEnabled ? ' /think' : ' /no_think'}` },
      ...chatMessages,
    ],
    stream: true,
    temperature: 0.5,
    top_p: thinkingEnabled ? 0.95 : 0.8,
    top_k: 20,
    min_p: 0,
    repetition_penalty: 1.2,
    repeat_last_n: 1024,
    chat_template_kwargs: { enable_thinking: thinkingEnabled },
  }
}

/** @internal Exported for testing only. */
export function processStreamChunk(acc: StreamAccumulator, text: string, reasoning: string): void {
  if (reasoning || text) {
    if (!acc.streamStartTime) acc.streamStartTime = Date.now()
    acc.totalTokens++
  }

  if (reasoning) {
    if (!acc.thinkingStartTime) acc.thinkingStartTime = Date.now()
    acc.thinking += reasoning
    acc.thinkingTokens++
  }

  if (text) acc.rawStream += text

  if (!acc.rawStream) return

  let remaining = acc.rawStream
  let chunkHadThinking = false
  if (acc.inThinkTag) {
    const closeIdx = remaining.indexOf('</think>')
    if (closeIdx !== -1) {
      acc.thinking += remaining.slice(0, closeIdx)
      chunkHadThinking = closeIdx > 0
      acc.inThinkTag = false
      remaining = remaining.slice(closeIdx + 8)
    } else {
      acc.thinking += remaining
      chunkHadThinking = remaining.length > 0
      acc.rawStream = ''
      if (chunkHadThinking) acc.thinkingTokens++
      return
    }
  }

  const openIdx = remaining.indexOf('<think>')
  if (openIdx !== -1) {
    acc.content += remaining.slice(0, openIdx)
    if (!acc.thinkingStartTime) acc.thinkingStartTime = Date.now()
    acc.inThinkTag = true
    const afterOpen = remaining.slice(openIdx + 7)
    const closeIdx = afterOpen.indexOf('</think>')
    if (closeIdx !== -1) {
      acc.thinking += afterOpen.slice(0, closeIdx)
      chunkHadThinking = chunkHadThinking || closeIdx > 0
      acc.inThinkTag = false
      acc.content += afterOpen.slice(closeIdx + 8)
    } else {
      acc.thinking += afterOpen
      chunkHadThinking = chunkHadThinking || afterOpen.length > 0
    }
  } else {
    acc.content += remaining
  }
  if (chunkHadThinking) acc.thinkingTokens++
  acc.rawStream = ''
}

export async function sendMessage(content: string) {
  const { addMessage, setAbortController, setGenerating, updateMessage } = useChatStore.getState()
  if (useChatStore.getState().isGenerating) return

  const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content }
  addMessage(userMsg)

  const assistantId = crypto.randomUUID()
  addMessage({ id: assistantId, role: 'assistant', content: '', thinking: '', isStreaming: true })

  const abort = new AbortController()
  setAbortController(abort)
  setGenerating(true)

  const acc = createAccumulator()
  const { thinkingEnabled, messages } = useChatStore.getState()
  const model: ModelId = thinkingEnabled ? 'qwen3.5-think' : 'qwen3.5-no-think'

  let rafId: number | null = null
  let dirty = false

  function scheduleFlush() {
    if (!dirty || rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      if (!dirty) return
      dirty = false
      updateMessage(assistantId, {
        content: acc.content,
        thinking: acc.thinking,
        thinkingTokens: acc.thinkingTokens,
        thinkingDurationMs: acc.thinkingStartTime ? Date.now() - acc.thinkingStartTime : 0,
        isThinking: acc.inThinkTag,
        totalTokens: acc.totalTokens,
        durationMs: acc.streamStartTime ? Date.now() - acc.streamStartTime : 0,
        model,
      })
    })
  }

  try {
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abort.signal,
      body: JSON.stringify(buildRequestPayload(messages, model, thinkingEnabled)),
    })

    if (!res.ok) throw new Error(`API error: ${res.status}`)
    const reader = res.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') break

        try {
          const delta = JSON.parse(data).choices?.[0]?.delta
          if (!delta) continue
          processStreamChunk(acc, delta.content || '', delta.reasoning_content || '')
          dirty = true
          scheduleFlush()
        } catch {
          // Ignore individual SSE chunk parse errors; stream continues
        }
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      acc.content = acc.content
        ? `${acc.content}\n\n[Error: ${(err as Error).message}]`
        : `Error: ${(err as Error).message}`
    }
  } finally {
    if (rafId !== null) cancelAnimationFrame(rafId)
    updateMessage(assistantId, {
      content: acc.content,
      thinking: acc.thinking.trimEnd(),
      thinkingTokens: acc.thinkingTokens,
      thinkingDurationMs: acc.thinkingStartTime ? Date.now() - acc.thinkingStartTime : 0,
      isThinking: false,
      isStreaming: false,
      totalTokens: acc.totalTokens,
      durationMs: acc.streamStartTime ? Date.now() - acc.streamStartTime : 0,
      model,
    })
    setGenerating(false)
    setAbortController(null)
  }
}
