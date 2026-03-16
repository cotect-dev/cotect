import { create } from 'zustand'

export type ModelId = 'qwen1' | 'qwen2'

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
  model: ModelId
  abortController: AbortController | null
  addMessage: (msg: Message) => void
  updateMessage: (id: string, update: Partial<Message>) => void
  setGenerating: (v: boolean) => void
  setThinkingEnabled: (v: boolean) => void
  setModel: (m: ModelId) => void
  setAbortController: (c: AbortController | null) => void
  clearMessages: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isGenerating: false,
  thinkingEnabled: true,
  model: 'qwen1',
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
  setModel: (model) => set({ model }),
  setAbortController: (abortController) => set({ abortController }),
  clearMessages: () => set({ messages: [] }),
}))

const API_BASE = '/llm/v1'

export async function sendMessage(content: string) {
  const store = useChatStore.getState()
  if (store.isGenerating) return

  const userMsg: Message = {
    id: crypto.randomUUID(),
    role: 'user',
    content,
  }
  store.addMessage(userMsg)

  const assistantMsg: Message = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    thinking: '',
    isStreaming: true,
  }
  store.addMessage(assistantMsg)

  const abort = new AbortController()
  store.setAbortController(abort)
  store.setGenerating(true)

  let accContent = ''
  let accThinking = ''
  let rawStream = ''
  let inThinkTag = false
  let thinkingTokens = 0
  let thinkingStartTime: number | null = null
  let totalTokens = 0
  let streamStartTime: number | null = null

  try {
    const { thinkingEnabled, model } = useChatStore.getState()
    const chatMessages = useChatStore.getState().messages
      .filter((m) => !m.isStreaming)
      .map((m) => ({ role: m.role, content: m.content }))

    const thinkSuffix = thinkingEnabled ? ' /think' : ' /no_think'
    const messages = [
      { role: 'system' as const, content: `You are a helpful assistant.${thinkSuffix}` },
      ...chatMessages,
    ]

    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abort.signal,
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.5,
        top_p: thinkingEnabled ? 0.95 : 0.8,
        top_k: 20,
        min_p: 0,
        repetition_penalty: 1.2,
        repeat_last_n: 1024,
        chat_template_kwargs: { enable_thinking: thinkingEnabled },
      }),
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
          const parsed = JSON.parse(data)
          const delta = parsed.choices?.[0]?.delta

          if (!delta) continue

          const text: string = delta.content || ''
          const reasoning: string = delta.reasoning_content || ''

          // Count each chunk as a token
          if (reasoning || text) {
            if (!streamStartTime) streamStartTime = Date.now()
            totalTokens++
          }

          // Handle reasoning_content field (some APIs)
          if (reasoning) {
            if (!thinkingStartTime) thinkingStartTime = Date.now()
            accThinking += reasoning
            thinkingTokens++
          }

          // Handle content field — may contain <think> tags
          if (text) {
            rawStream += text
          }

          // Parse <think> tags from the accumulated raw stream
          if (rawStream) {
            let remaining = rawStream
            // Check if we're inside a <think> block
            if (inThinkTag) {
              const closeIdx = remaining.indexOf('</think>')
              if (closeIdx !== -1) {
                // End of thinking block
                const chunk = remaining.slice(0, closeIdx)
                accThinking += chunk
                thinkingTokens += chunk.split(/\s+/).filter(Boolean).length
                inThinkTag = false
                remaining = remaining.slice(closeIdx + 8) // skip </think>
              } else {
                // Still inside think block — consume all as thinking
                accThinking += remaining
                thinkingTokens += remaining.split(/\s+/).filter(Boolean).length
                remaining = ''
              }
            }

            if (!inThinkTag) {
              const openIdx = remaining.indexOf('<think>')
              if (openIdx !== -1) {
                // Content before <think>
                accContent += remaining.slice(0, openIdx)
                if (!thinkingStartTime) thinkingStartTime = Date.now()
                inThinkTag = true
                const afterOpen = remaining.slice(openIdx + 7) // skip <think>
                const closeIdx = afterOpen.indexOf('</think>')
                if (closeIdx !== -1) {
                  accThinking += afterOpen.slice(0, closeIdx)
                  thinkingTokens += afterOpen.slice(0, closeIdx).split(/\s+/).filter(Boolean).length
                  inThinkTag = false
                  accContent += afterOpen.slice(closeIdx + 8)
                } else {
                  accThinking += afterOpen
                  thinkingTokens += afterOpen.split(/\s+/).filter(Boolean).length
                }
              } else {
                accContent += remaining
              }
            }
            rawStream = ''
          }

          const elapsed = streamStartTime ? Date.now() - streamStartTime : 0
          store.updateMessage(assistantMsg.id, {
            content: accContent,
            thinking: accThinking,
            thinkingTokens,
            thinkingDurationMs: thinkingStartTime ? Date.now() - thinkingStartTime : 0,
            isThinking: inThinkTag,
            totalTokens,
            durationMs: elapsed,
            model,
          })
        } catch {
          // skip malformed chunks
        }
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      store.updateMessage(assistantMsg.id, {
        content: accContent || `Error: ${(err as Error).message}`,
      })
    }
  } finally {
    store.updateMessage(assistantMsg.id, { isStreaming: false })
    store.setGenerating(false)
    store.setAbortController(null)
  }
}
