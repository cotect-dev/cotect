import { create } from 'zustand'
import { createStoreWithHMR } from '@/lib/hmr'
import * as agentService from '@/services/agent'
import type { AgentConfig, ProviderConfig } from '@/services/agent'

interface SettingsState {
  config: AgentConfig | null
  loading: boolean
  testResult: { models: string[]; error?: string } | null
  testing: boolean

  loadConfig: () => Promise<void>
  saveConfig: (config: AgentConfig) => Promise<void>
  addProvider: (provider: ProviderConfig) => Promise<void>
  removeProvider: (id: string) => Promise<void>
  updateProvider: (id: string, updates: Partial<ProviderConfig>) => Promise<void>
  setActiveProvider: (id: string) => Promise<void>
  testProvider: (config: ProviderConfig) => Promise<void>
  clearTestResult: () => void
}

export const useSettingsStore = createStoreWithHMR(import.meta.hot, 'settings', () =>
  create<SettingsState>((set, get) => {
    /** Apply a config mutation and persist it. Noop if config isn't loaded. */
    async function mutateConfig(fn: (config: AgentConfig) => AgentConfig) {
      const { config, saveConfig } = get()
      if (!config) return
      await saveConfig(fn(config))
    }

    return {
      config: null,
      loading: false,
      testResult: null,
      testing: false,

      loadConfig: async () => {
        if (get().config) return
        set({ loading: true })
        try {
          const config = await agentService.getConfig()
          set({ config, loading: false })
        } catch (err) {
          console.error('Failed to load agent config:', err)
          set({ loading: false })
        }
      },

      saveConfig: async (config) => {
        await agentService.setConfig(config)
        set({ config })
      },

      addProvider: (provider) =>
        mutateConfig((c) => ({ ...c, providers: [...c.providers, provider] })),

      removeProvider: (id) =>
        mutateConfig((c) => ({
          ...c,
          providers: c.providers.filter((p) => p.id !== id),
          active_provider_id:
            c.active_provider_id === id
              ? c.providers.find((p) => p.id !== id)?.id ?? ''
              : c.active_provider_id,
        })),

      updateProvider: (id, updates) =>
        mutateConfig((c) => ({
          ...c,
          providers: c.providers.map((p) => (p.id === id ? { ...p, ...updates } : p)),
        })),

      setActiveProvider: (id) =>
        mutateConfig((c) => ({ ...c, active_provider_id: id })),

      testProvider: async (config) => {
        set({ testing: true, testResult: null })
        try {
          const models = await agentService.testConnection(config)
          set({ testResult: { models }, testing: false })
        } catch (err) {
          set({ testResult: { models: [], error: String(err) }, testing: false })
        }
      },

      clearTestResult: () => set({ testResult: null }),
    }
  }),
)
