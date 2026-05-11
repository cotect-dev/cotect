import { create } from 'zustand'
import { createStoreWithHMR } from '@/lib/hmr'
import {
  providersList,
  providersUpsert,
  providersRemove,
  assignmentGet,
  assignmentSet,
  type Provider,
  type ActiveAssignment,
} from '@/services/db'

interface ProvidersState {
  providers: Provider[]
  assignment: ActiveAssignment | null
  loading: boolean
  error: string | null

  init: () => Promise<void>
  upsert: (p: Provider) => Promise<void>
  remove: (id: string) => Promise<void>
  setAssignment: (a: ActiveAssignment) => Promise<void>
  refresh: () => Promise<void>
}

export const useProvidersStore = createStoreWithHMR(import.meta.hot, 'providers', () =>
  create<ProvidersState>((set, get) => ({
    providers: [],
    assignment: null,
    loading: false,
    error: null,

    init: async () => {
      set({ loading: true, error: null })
      try {
        const [providers, assignment] = await Promise.all([providersList(), assignmentGet()])
        set({ providers, assignment, loading: false })
      } catch (err) {
        set({ loading: false, error: String(err) })
      }
    },

    refresh: async () => {
      const providers = await providersList()
      set({ providers })
    },

    upsert: async (p) => {
      await providersUpsert(p)
      await get().refresh()
    },

    remove: async (id) => {
      await providersRemove(id)
      await get().refresh()
      const a = await assignmentGet()
      set({ assignment: a })
    },

    setAssignment: async (a) => {
      await assignmentSet(a)
      set({ assignment: a })
    },
  })),
)
