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

import { useChatStore } from './chat'

describe('useChatStore', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      isGenerating: false,
      thinkingEnabled: true,
      abortController: null,
    })
  })

  describe('updateMessage', () => {
    it('preserves other fields when partially updating', () => {
      useChatStore.getState().addMessage({ id: '1', role: 'assistant', content: 'Hello', thinking: 'thought' })
      useChatStore.getState().updateMessage('1', { content: 'Updated' })
      expect(useChatStore.getState().messages[0].content).toBe('Updated')
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
})
