import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'

// Mock platform before importing stores
vi.mock('@/services/platform', () => ({
  getPlatform: () => ({
    syncedState: {
      set: vi.fn(),
      get: vi.fn().mockResolvedValue(null),
      clear: vi.fn(),
      listen: vi.fn().mockReturnValue(() => {}),
    },
    windows: {
      getWindowId: () => 'test-window',
    },
  }),
}))

import { useChatStore, sendMessage, buildRequestPayload, type Message, type ModelId } from './chat'

// --- SSE stream helpers ---

function encodeSSEChunk(delta: { content?: string; reasoning_content?: string }): string {
  const data = JSON.stringify({ choices: [{ delta }] })
  return `data: ${data}\n\n`
}

function createSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let index = 0
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]))
        index++
      } else {
        controller.close()
      }
    },
  })
}

function mockFetchSuccess(chunks: string[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    body: createSSEStream(chunks),
  })
}

function mockFetchError(status: number) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
  })
}

describe('buildRequestPayload', () => {
  it('builds correct payload with thinking enabled', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Hello' },
    ]
    const payload = buildRequestPayload(messages, 'qwen3.5-think', true)

    expect(payload.model).toBe('qwen3.5-think')
    expect(payload.stream).toBe(true)
    expect(payload.messages[0].role).toBe('system')
    expect(payload.messages[0].content).toContain('/think')
    expect(payload.messages[1]).toEqual({ role: 'user', content: 'Hello' })
    expect(payload.top_p).toBe(0.95)
    expect(payload.chat_template_kwargs.enable_thinking).toBe(true)
  })

  it('builds correct payload with thinking disabled', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Hello' },
    ]
    const payload = buildRequestPayload(messages, 'qwen3.5-no-think', false)

    expect(payload.messages[0].content).toContain('/no_think')
    expect(payload.top_p).toBe(0.8)
    expect(payload.chat_template_kwargs.enable_thinking).toBe(false)
  })

  it('filters out streaming messages', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Hello' },
      { id: '2', role: 'assistant', content: '', isStreaming: true },
    ]
    const payload = buildRequestPayload(messages, 'qwen3.5-think', true)

    // system + user only (streaming assistant filtered out)
    expect(payload.messages).toHaveLength(2)
  })
})

describe('sendMessage', () => {
  let originalFetch: typeof global.fetch
  let originalRAF: typeof global.requestAnimationFrame
  let originalCAF: typeof global.cancelAnimationFrame
  let originalRandomUUID: typeof crypto.randomUUID

  beforeEach(() => {
    // Save originals
    originalFetch = global.fetch
    originalRAF = global.requestAnimationFrame
    originalCAF = global.cancelAnimationFrame
    originalRandomUUID = crypto.randomUUID

    // Mock RAF to execute synchronously
    global.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0)
      return 0
    }) as typeof requestAnimationFrame
    global.cancelAnimationFrame = vi.fn()

    // Mock deterministic UUIDs
    let uuidCounter = 0
    crypto.randomUUID = (() => `uuid-${uuidCounter++}`) as typeof crypto.randomUUID

    // Reset store
    useChatStore.setState({
      messages: [],
      isGenerating: false,
      thinkingEnabled: true,
      abortController: null,
    })
  })

  afterEach(() => {
    global.fetch = originalFetch
    global.requestAnimationFrame = originalRAF
    global.cancelAnimationFrame = originalCAF
    crypto.randomUUID = originalRandomUUID
  })

  it('does nothing when already generating', async () => {
    useChatStore.setState({ isGenerating: true })
    global.fetch = vi.fn()

    await sendMessage('hello')

    expect(global.fetch).not.toHaveBeenCalled()
    expect(useChatStore.getState().messages).toEqual([])
  })

  it('adds user and assistant messages to the store', async () => {
    global.fetch = mockFetchSuccess([
      encodeSSEChunk({ content: 'Hi' }),
      'data: [DONE]\n\n',
    ])

    await sendMessage('hello')

    const messages = useChatStore.getState().messages
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('hello')
    expect(messages[1].role).toBe('assistant')
  })

  it('streams content into the assistant message', async () => {
    global.fetch = mockFetchSuccess([
      encodeSSEChunk({ content: 'Hello' }),
      encodeSSEChunk({ content: ' world' }),
      'data: [DONE]\n\n',
    ])

    await sendMessage('hi')

    const messages = useChatStore.getState().messages
    const assistant = messages.find((m) => m.role === 'assistant')
    expect(assistant).toBeDefined()
    expect(assistant!.content).toBe('Hello world')
    expect(assistant!.isStreaming).toBe(false)
  })

  it('handles reasoning content in stream', async () => {
    global.fetch = mockFetchSuccess([
      encodeSSEChunk({ reasoning_content: 'thinking...' }),
      encodeSSEChunk({ content: 'answer' }),
      'data: [DONE]\n\n',
    ])

    await sendMessage('question')

    const messages = useChatStore.getState().messages
    const assistant = messages.find((m) => m.role === 'assistant')
    expect(assistant!.content).toBe('answer')
    expect(assistant!.thinking).toContain('thinking...')
  })

  it('sets model based on thinkingEnabled state', async () => {
    useChatStore.setState({ thinkingEnabled: false })
    global.fetch = mockFetchSuccess(['data: [DONE]\n\n'])

    await sendMessage('test')

    // Check the fetch was called with the no-think model
    const fetchCall = (global.fetch as Mock).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.model).toBe('qwen3.5-no-think')
  })

  it('resets isGenerating and abortController after completion', async () => {
    global.fetch = mockFetchSuccess(['data: [DONE]\n\n'])

    await sendMessage('test')

    expect(useChatStore.getState().isGenerating).toBe(false)
    expect(useChatStore.getState().abortController).toBeNull()
  })

  it('handles API error (non-ok response)', async () => {
    global.fetch = mockFetchError(500)

    await sendMessage('test')

    const messages = useChatStore.getState().messages
    const assistant = messages.find((m) => m.role === 'assistant')
    expect(assistant!.content).toContain('Error')
    expect(assistant!.content).toContain('500')
    expect(assistant!.isStreaming).toBe(false)
    expect(useChatStore.getState().isGenerating).toBe(false)
    expect(useChatStore.getState().abortController).toBeNull()
  })

  it('appends error to partial content when stream fails mid-way', async () => {
    // Simulate a stream that delivers some content then throws
    const encoder = new TextEncoder()
    let callCount = 0
    const brokenStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        callCount++
        if (callCount === 1) {
          const chunk = `data: ${JSON.stringify({ choices: [{ delta: { content: 'Partial answer' } }] })}\n\n`
          controller.enqueue(encoder.encode(chunk))
        } else {
          controller.error(new Error('Connection lost'))
        }
      },
    })
    global.fetch = vi.fn().mockResolvedValue({ ok: true, body: brokenStream })

    await sendMessage('test')

    const messages = useChatStore.getState().messages
    const assistant = messages.find((m) => m.role === 'assistant')
    // Should contain BOTH the partial content AND the error
    expect(assistant!.content).toContain('Partial answer')
    expect(assistant!.content).toContain('Connection lost')
    expect(assistant!.isStreaming).toBe(false)
  })

  it('handles missing response body', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: null,
    })

    await sendMessage('test')

    const messages = useChatStore.getState().messages
    const assistant = messages.find((m) => m.role === 'assistant')
    expect(assistant!.content).toContain('Error')
    expect(assistant!.content).toContain('No response body')
    expect(assistant!.isStreaming).toBe(false)
    expect(useChatStore.getState().isGenerating).toBe(false)
  })

  it('handles abort gracefully (no error message)', async () => {
    // Create a fetch that will be aborted
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      // Simulate abort
      const error = new DOMException('The operation was aborted.', 'AbortError')
      init.signal?.addEventListener('abort', () => {})
      return Promise.reject(error)
    })

    // Send message, then immediately abort
    const promise = sendMessage('test')

    // The abort controller is set by now
    const controller = useChatStore.getState().abortController
    controller?.abort()

    await promise

    const messages = useChatStore.getState().messages
    const assistant = messages.find((m) => m.role === 'assistant')
    // On abort, the content should NOT contain "Error:" prefix
    expect(assistant!.content).not.toContain('Error:')
    expect(useChatStore.getState().isGenerating).toBe(false)
  })

  it('ignores malformed JSON in SSE chunks and continues', async () => {
    global.fetch = mockFetchSuccess([
      encodeSSEChunk({ content: 'before' }),
      'data: {invalid json}\n\n',
      encodeSSEChunk({ content: ' after' }),
      'data: [DONE]\n\n',
    ])

    await sendMessage('test')

    const messages = useChatStore.getState().messages
    const assistant = messages.find((m) => m.role === 'assistant')
    expect(assistant!.content).toBe('before after')
  })

  it('sends correct request payload', async () => {
    global.fetch = mockFetchSuccess(['data: [DONE]\n\n'])

    await sendMessage('hello')

    expect(global.fetch).toHaveBeenCalledWith(
      '/llm/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const body = JSON.parse((global.fetch as Mock).mock.calls[0][1].body)
    expect(body.stream).toBe(true)
    expect(body.model).toBe('qwen3.5-think')
    // system + user message (assistant streaming message is filtered)
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hello' })
  })

  it('marks assistant message as not streaming in finally block', async () => {
    global.fetch = mockFetchSuccess([
      encodeSSEChunk({ content: 'done' }),
      'data: [DONE]\n\n',
    ])

    await sendMessage('test')

    const messages = useChatStore.getState().messages
    const assistant = messages.find((m) => m.role === 'assistant')
    expect(assistant!.isStreaming).toBe(false)
    expect(assistant!.isThinking).toBe(false)
  })
})
