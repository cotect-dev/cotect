import { create } from 'zustand'

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

export const useChatStore = create<ChatState>((set) => ({
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
}))

const API_BASE = '/llm/v1'

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

  let accContent = ''
  let accThinking = ''
  let rawStream = ''
  let inThinkTag = false
  let thinkingTokens = 0
  let thinkingStartTime: number | null = null
  let totalTokens = 0
  let streamStartTime: number | null = null

  try {
    const { thinkingEnabled, messages } = useChatStore.getState()
    const model: ModelId = thinkingEnabled ? 'qwen3.5-think' : 'qwen3.5-no-think'
    const chatMessages = messages
      .filter((m) => !m.isStreaming)
      .map((m) => ({ role: m.role, content: m.content }))

    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abort.signal,
      body: JSON.stringify({
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
          const delta = JSON.parse(data).choices?.[0]?.delta
          if (!delta) continue

          const text: string = delta.content || ''
          const reasoning: string = delta.reasoning_content || ''

          if (reasoning || text) {
            if (!streamStartTime) streamStartTime = Date.now()
            totalTokens++
          }

          if (reasoning) {
            if (!thinkingStartTime) thinkingStartTime = Date.now()
            accThinking += reasoning
            thinkingTokens++
          }

          if (text) rawStream += text

          if (rawStream) {
            let remaining = rawStream
            if (inThinkTag) {
              const closeIdx = remaining.indexOf('</think>')
              if (closeIdx !== -1) {
                accThinking += remaining.slice(0, closeIdx)
                thinkingTokens += remaining.slice(0, closeIdx).split(/\s+/).filter(Boolean).length
                inThinkTag = false
                remaining = remaining.slice(closeIdx + 8)
              } else {
                accThinking += remaining
                thinkingTokens += remaining.split(/\s+/).filter(Boolean).length
                remaining = ''
              }
            }

            if (!inThinkTag) {
              const openIdx = remaining.indexOf('<think>')
              if (openIdx !== -1) {
                accContent += remaining.slice(0, openIdx)
                if (!thinkingStartTime) thinkingStartTime = Date.now()
                inThinkTag = true
                const afterOpen = remaining.slice(openIdx + 7)
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

          updateMessage(assistantId, {
            content: accContent,
            thinking: accThinking,
            thinkingTokens,
            thinkingDurationMs: thinkingStartTime ? Date.now() - thinkingStartTime : 0,
            isThinking: inThinkTag,
            totalTokens,
            durationMs: streamStartTime ? Date.now() - streamStartTime : 0,
            model,
          })
        } catch {
          // skip malformed chunks
        }
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      updateMessage(assistantId, {
        content: accContent || `Error: ${(err as Error).message}`,
      })
    }
  } finally {
    updateMessage(assistantId, { isStreaming: false, thinking: accThinking.trimEnd() })
    setGenerating(false)
    setAbortController(null)
  }
}
