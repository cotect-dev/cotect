import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock platform before importing stores that depend on it
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

import { useChatStore, type Message } from './chat'

describe('useChatStore', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      isGenerating: false,
      thinkingEnabled: true,
      abortController: null,
    })
  })

  it('starts with empty messages', () => {
    expect(useChatStore.getState().messages).toEqual([])
  })

  it('starts with isGenerating false', () => {
    expect(useChatStore.getState().isGenerating).toBe(false)
  })

  it('starts with thinkingEnabled true', () => {
    expect(useChatStore.getState().thinkingEnabled).toBe(true)
  })

  describe('addMessage', () => {
    it('adds a message to the store', () => {
      const msg: Message = { id: '1', role: 'user', content: 'Hello' }
      useChatStore.getState().addMessage(msg)
      expect(useChatStore.getState().messages).toHaveLength(1)
      expect(useChatStore.getState().messages[0]).toEqual(msg)
    })

    it('appends messages in order', () => {
      useChatStore.getState().addMessage({ id: '1', role: 'user', content: 'First' })
      useChatStore.getState().addMessage({ id: '2', role: 'assistant', content: 'Second' })
      const messages = useChatStore.getState().messages
      expect(messages).toHaveLength(2)
      expect(messages[0].content).toBe('First')
      expect(messages[1].content).toBe('Second')
    })
  })

  describe('updateMessage', () => {
    it('updates an existing message by id', () => {
      useChatStore.getState().addMessage({ id: '1', role: 'assistant', content: 'Hello' })
      useChatStore.getState().updateMessage('1', { content: 'Updated' })
      expect(useChatStore.getState().messages[0].content).toBe('Updated')
    })

    it('preserves other fields when updating', () => {
      useChatStore.getState().addMessage({ id: '1', role: 'assistant', content: 'Hello', thinking: 'thought' })
      useChatStore.getState().updateMessage('1', { content: 'Updated' })
      expect(useChatStore.getState().messages[0].thinking).toBe('thought')
    })

    it('does not affect other messages', () => {
      useChatStore.getState().addMessage({ id: '1', role: 'user', content: 'A' })
      useChatStore.getState().addMessage({ id: '2', role: 'assistant', content: 'B' })
      useChatStore.getState().updateMessage('2', { content: 'Updated B' })
      expect(useChatStore.getState().messages[0].content).toBe('A')
      expect(useChatStore.getState().messages[1].content).toBe('Updated B')
    })

    it('handles non-existent id gracefully', () => {
      useChatStore.getState().addMessage({ id: '1', role: 'user', content: 'A' })
      useChatStore.getState().updateMessage('nonexistent', { content: 'X' })
      expect(useChatStore.getState().messages).toHaveLength(1)
      expect(useChatStore.getState().messages[0].content).toBe('A')
    })
  })

  describe('setGenerating', () => {
    it('sets isGenerating to true', () => {
      useChatStore.getState().setGenerating(true)
      expect(useChatStore.getState().isGenerating).toBe(true)
    })

    it('sets isGenerating to false', () => {
      useChatStore.getState().setGenerating(true)
      useChatStore.getState().setGenerating(false)
      expect(useChatStore.getState().isGenerating).toBe(false)
    })
  })

  describe('setThinkingEnabled', () => {
    it('toggles thinkingEnabled', () => {
      useChatStore.getState().setThinkingEnabled(false)
      expect(useChatStore.getState().thinkingEnabled).toBe(false)
      useChatStore.getState().setThinkingEnabled(true)
      expect(useChatStore.getState().thinkingEnabled).toBe(true)
    })
  })

  describe('setAbortController', () => {
    it('sets the abort controller', () => {
      const controller = new AbortController()
      useChatStore.getState().setAbortController(controller)
      expect(useChatStore.getState().abortController).toBe(controller)
    })

    it('sets to null', () => {
      const controller = new AbortController()
      useChatStore.getState().setAbortController(controller)
      useChatStore.getState().setAbortController(null)
      expect(useChatStore.getState().abortController).toBeNull()
    })
  })

  describe('clearMessages', () => {
    it('clears all messages', () => {
      useChatStore.getState().addMessage({ id: '1', role: 'user', content: 'A' })
      useChatStore.getState().addMessage({ id: '2', role: 'assistant', content: 'B' })
      useChatStore.getState().clearMessages()
      expect(useChatStore.getState().messages).toEqual([])
    })
  })
})
