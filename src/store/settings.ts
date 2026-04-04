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
  create<SettingsState>((set, get) => ({
    config: null,
    loading: false,
    testResult: null,
    testing: false,

    loadConfig: async () => {
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

    addProvider: async (provider) => {
      const { config } = get()
      if (!config) return
      const newConfig: AgentConfig = {
        ...config,
        providers: [...config.providers, provider],
      }
      await get().saveConfig(newConfig)
    },

    removeProvider: async (id) => {
      const { config } = get()
      if (!config) return
      const newConfig: AgentConfig = {
        ...config,
        providers: config.providers.filter((p) => p.id !== id),
        active_provider_id:
          config.active_provider_id === id
            ? config.providers.find((p) => p.id !== id)?.id ?? ''
            : config.active_provider_id,
      }
      await get().saveConfig(newConfig)
    },

    updateProvider: async (id, updates) => {
      const { config } = get()
      if (!config) return
      const newConfig: AgentConfig = {
        ...config,
        providers: config.providers.map((p) =>
          p.id === id ? { ...p, ...updates } : p,
        ),
      }
      await get().saveConfig(newConfig)
    },

    setActiveProvider: async (id) => {
      const { config } = get()
      if (!config) return
      const newConfig: AgentConfig = {
        ...config,
        active_provider_id: id,
      }
      await get().saveConfig(newConfig)
    },

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
  })),
)
