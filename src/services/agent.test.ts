import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import * as agent from './agent'

vi.mock('@tauri-apps/api/core')
vi.mock('@tauri-apps/api/event')

describe('agent service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('startTask', () => {
    it('propagates errors', async () => {
      vi.mocked(invoke).mockRejectedValue(new Error('No provider'))

      const request: agent.TaskRequest = {
        id: 'task-1',
        prompt: 'Test',
        scope: { root_path: '/project', files: [] },
        role: 'research',
      }

      await expect(agent.startTask(request)).rejects.toThrow('No provider')
    })
  })

  describe('listenToTask', () => {
    it('registers listener on correct event channel', () => {
      const unlisten = vi.fn()
      vi.mocked(listen).mockResolvedValue(unlisten)

      const callback = vi.fn()
      const unsubscribe = agent.listenToTask('task-42', callback)

      expect(listen).toHaveBeenCalledWith('agent-task-event:task-42', expect.any(Function))
      expect(typeof unsubscribe).toBe('function')
    })

    it('cleanup function calls unlisten after promise resolves', async () => {
      const unlisten = vi.fn()
      vi.mocked(listen).mockResolvedValue(unlisten)

      const callback = vi.fn()
      const cleanup = agent.listenToTask('task-99', callback)

      cleanup()

      await vi.waitFor(() => {
        expect(unlisten).toHaveBeenCalled()
      })
    })
  })
})
