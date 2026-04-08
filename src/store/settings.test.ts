import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSettingsStore } from './settings'
import * as agentService from '@/services/agent'

vi.mock('@/services/agent', () => ({
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  testConnection: vi.fn(),
}))

describe('useSettingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      config: null,
      loading: false,
      testResult: null,
      testing: false,
    })
    vi.clearAllMocks()
  })

  describe('loadConfig', () => {
    it('loads config from backend', async () => {
      const config: agentService.AgentConfig = {
        providers: [{ id: 'p1', name: 'Test', endpoint: 'http://localhost', model: 'gpt-4' }],
        active_provider_id: 'p1',
      }
      vi.mocked(agentService.getConfig).mockResolvedValue(config)

      await useSettingsStore.getState().loadConfig()

      expect(useSettingsStore.getState().config).toEqual(config)
      expect(useSettingsStore.getState().loading).toBe(false)
    })

    it('sets loading during fetch', async () => {
      let resolveConfig: (v: agentService.AgentConfig) => void
      const promise = new Promise<agentService.AgentConfig>((r) => { resolveConfig = r })
      vi.mocked(agentService.getConfig).mockReturnValue(promise)

      const loadPromise = useSettingsStore.getState().loadConfig()
      expect(useSettingsStore.getState().loading).toBe(true)

      resolveConfig!({ providers: [], active_provider_id: '' })
      await loadPromise
      expect(useSettingsStore.getState().loading).toBe(false)
    })

    it('handles errors gracefully', async () => {
      vi.mocked(agentService.getConfig).mockRejectedValue(new Error('Connection refused'))

      await useSettingsStore.getState().loadConfig()

      expect(useSettingsStore.getState().config).toBeNull()
      expect(useSettingsStore.getState().loading).toBe(false)
    })

    it('skips IPC call when config is already loaded', async () => {
      const config: agentService.AgentConfig = {
        providers: [{ id: 'p1', name: 'Test', endpoint: 'http://localhost', model: 'gpt-4' }],
        active_provider_id: 'p1',
      }
      vi.mocked(agentService.getConfig).mockResolvedValue(config)

      // First load — should call getConfig
      await useSettingsStore.getState().loadConfig()
      expect(agentService.getConfig).toHaveBeenCalledTimes(1)

      // Reset mock call count
      vi.mocked(agentService.getConfig).mockClear()

      // Second load — config already present, should skip IPC
      await useSettingsStore.getState().loadConfig()
      expect(agentService.getConfig).not.toHaveBeenCalled()
    })
  })

  describe('saveConfig', () => {
    it('saves config to backend and updates local state', async () => {
      vi.mocked(agentService.setConfig).mockResolvedValue(undefined)

      const config: agentService.AgentConfig = {
        providers: [{ id: 'p1', name: 'Test', endpoint: 'http://localhost', model: 'llama3' }],
        active_provider_id: 'p1',
      }

      await useSettingsStore.getState().saveConfig(config)

      expect(agentService.setConfig).toHaveBeenCalledWith(config)
      expect(useSettingsStore.getState().config).toEqual(config)
    })
  })

  describe('addProvider', () => {
    it('appends provider to existing config', async () => {
      vi.mocked(agentService.setConfig).mockResolvedValue(undefined)

      useSettingsStore.setState({
        config: {
          providers: [{ id: 'p1', name: 'First', endpoint: 'http://a', model: 'm1' }],
          active_provider_id: 'p1',
        },
      })

      await useSettingsStore.getState().addProvider({
        id: 'p2',
        name: 'Second',
        endpoint: 'http://b',
        model: 'm2',
      })

      const { config } = useSettingsStore.getState()
      expect(config!.providers).toHaveLength(2)
      expect(config!.providers[1].id).toBe('p2')
    })

    it('does nothing without config', async () => {
      await useSettingsStore.getState().addProvider({
        id: 'p1',
        name: 'Test',
        endpoint: 'http://a',
        model: 'm1',
      })

      expect(agentService.setConfig).not.toHaveBeenCalled()
    })
  })

  describe('removeProvider', () => {
    it('removes provider by id', async () => {
      vi.mocked(agentService.setConfig).mockResolvedValue(undefined)

      useSettingsStore.setState({
        config: {
          providers: [
            { id: 'p1', name: 'First', endpoint: 'http://a', model: 'm1' },
            { id: 'p2', name: 'Second', endpoint: 'http://b', model: 'm2' },
          ],
          active_provider_id: 'p1',
        },
      })

      await useSettingsStore.getState().removeProvider('p1')

      const { config } = useSettingsStore.getState()
      expect(config!.providers).toHaveLength(1)
      expect(config!.providers[0].id).toBe('p2')
      // Active provider should switch
      expect(config!.active_provider_id).toBe('p2')
    })

    it('keeps active_provider_id when removing inactive provider', async () => {
      vi.mocked(agentService.setConfig).mockResolvedValue(undefined)

      useSettingsStore.setState({
        config: {
          providers: [
            { id: 'p1', name: 'First', endpoint: 'http://a', model: 'm1' },
            { id: 'p2', name: 'Second', endpoint: 'http://b', model: 'm2' },
          ],
          active_provider_id: 'p1',
        },
      })

      await useSettingsStore.getState().removeProvider('p2')

      expect(useSettingsStore.getState().config!.active_provider_id).toBe('p1')
    })
  })

  describe('updateProvider', () => {
    it('partially updates a provider', async () => {
      vi.mocked(agentService.setConfig).mockResolvedValue(undefined)

      useSettingsStore.setState({
        config: {
          providers: [{ id: 'p1', name: 'Old', endpoint: 'http://a', model: 'old-model' }],
          active_provider_id: 'p1',
        },
      })

      await useSettingsStore.getState().updateProvider('p1', { model: 'new-model', name: 'New' })

      const provider = useSettingsStore.getState().config!.providers[0]
      expect(provider.model).toBe('new-model')
      expect(provider.name).toBe('New')
      expect(provider.endpoint).toBe('http://a') // unchanged
    })
  })

  describe('setActiveProvider', () => {
    it('changes the active provider id', async () => {
      vi.mocked(agentService.setConfig).mockResolvedValue(undefined)

      useSettingsStore.setState({
        config: {
          providers: [
            { id: 'p1', name: 'First', endpoint: 'http://a', model: 'm1' },
            { id: 'p2', name: 'Second', endpoint: 'http://b', model: 'm2' },
          ],
          active_provider_id: 'p1',
        },
      })

      await useSettingsStore.getState().setActiveProvider('p2')

      expect(useSettingsStore.getState().config!.active_provider_id).toBe('p2')
    })
  })

  describe('testProvider', () => {
    it('returns models on success', async () => {
      vi.mocked(agentService.testConnection).mockResolvedValue(['model-a', 'model-b'])

      const config: agentService.ProviderConfig = {
        id: 'test',
        name: 'Test',
        endpoint: 'http://localhost',
        model: '',
      }

      await useSettingsStore.getState().testProvider(config)

      const { testResult, testing } = useSettingsStore.getState()
      expect(testing).toBe(false)
      expect(testResult!.models).toEqual(['model-a', 'model-b'])
      expect(testResult!.error).toBeUndefined()
    })

    it('returns error on failure', async () => {
      vi.mocked(agentService.testConnection).mockRejectedValue(new Error('Connection refused'))

      const config: agentService.ProviderConfig = {
        id: 'test',
        name: 'Test',
        endpoint: 'http://localhost',
        model: '',
      }

      await useSettingsStore.getState().testProvider(config)

      const { testResult, testing } = useSettingsStore.getState()
      expect(testing).toBe(false)
      expect(testResult!.models).toEqual([])
      expect(testResult!.error).toContain('Connection refused')
    })

    it('sets testing flag during test', async () => {
      let resolveTest: (v: string[]) => void
      const promise = new Promise<string[]>((r) => { resolveTest = r })
      vi.mocked(agentService.testConnection).mockReturnValue(promise)

      const testPromise = useSettingsStore.getState().testProvider({
        id: 'test', name: 'Test', endpoint: 'http://localhost', model: '',
      })

      expect(useSettingsStore.getState().testing).toBe(true)

      resolveTest!(['model-a'])
      await testPromise

      expect(useSettingsStore.getState().testing).toBe(false)
    })
  })

  describe('clearTestResult', () => {
    it('clears the test result', () => {
      useSettingsStore.setState({ testResult: { models: ['a'], error: undefined } })
      useSettingsStore.getState().clearTestResult()
      expect(useSettingsStore.getState().testResult).toBeNull()
    })
  })
})
