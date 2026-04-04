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
    it('calls invoke with correct command and args', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined)

      const request: agent.TaskRequest = {
        id: 'task-1',
        prompt: 'Fix the bug',
        scope: { root_path: '/project', files: ['src/main.ts'] },
        role: 'implement',
      }

      await agent.startTask(request)

      expect(invoke).toHaveBeenCalledWith('agent_start_task', { request })
    })

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

  describe('abortTask', () => {
    it('calls invoke with task id', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined)

      await agent.abortTask('task-123')

      expect(invoke).toHaveBeenCalledWith('agent_abort', { taskId: 'task-123' })
    })
  })

  describe('getConfig', () => {
    it('returns config from Rust', async () => {
      const config: agent.AgentConfig = {
        providers: [{ id: 'test', name: 'Test', endpoint: 'http://localhost', model: 'gpt-4' }],
        active_provider_id: 'test',
      }
      vi.mocked(invoke).mockResolvedValue(config)

      const result = await agent.getConfig()

      expect(invoke).toHaveBeenCalledWith('agent_get_config')
      expect(result).toEqual(config)
    })
  })

  describe('setConfig', () => {
    it('sends config to Rust', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined)
      const config: agent.AgentConfig = {
        providers: [],
        active_provider_id: '',
      }

      await agent.setConfig(config)

      expect(invoke).toHaveBeenCalledWith('agent_set_config', { config })
    })
  })

  describe('testConnection', () => {
    it('returns model list', async () => {
      vi.mocked(invoke).mockResolvedValue(['gpt-4', 'gpt-3.5-turbo'])

      const config: agent.ProviderConfig = {
        id: 'test',
        name: 'Test',
        endpoint: 'http://localhost',
        model: '',
      }

      const models = await agent.testConnection(config)

      expect(invoke).toHaveBeenCalledWith('agent_test_connection', { config })
      expect(models).toEqual(['gpt-4', 'gpt-3.5-turbo'])
    })
  })

  describe('listenToTask', () => {
    it('registers listener on correct event channel', () => {
      const unlisten = vi.fn()
      vi.mocked(listen).mockResolvedValue(unlisten)

      const callback = vi.fn()
      const unsubscribe = agent.listenToTask('task-42', callback)

      expect(listen).toHaveBeenCalledWith('agent-task-event:task-42', expect.any(Function))

      // Cleanup should call unlisten
      // Note: unlisten is set async, so we verify the returned function exists
      expect(typeof unsubscribe).toBe('function')
    })
  })
})
