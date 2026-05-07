import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useProvidersStore } from './providers'

vi.mock('@/services/db', () => ({
  providersList: vi.fn(),
  providersUpsert: vi.fn(),
  providersRemove: vi.fn(),
  assignmentGet: vi.fn(),
  assignmentSet: vi.fn(),
}))

import { providersList, providersUpsert, providersRemove, assignmentGet, assignmentSet } from '@/services/db'

describe('useProvidersStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProvidersStore.setState({ providers: [], assignment: null, loading: false, error: null })
  })

  it('loads providers + assignment on init', async () => {
    vi.mocked(providersList).mockResolvedValue([
      { id: 'p1', label: 'L', endpoint: 'http://x', api_key: null, detected_json: null, health_json: null, position: 0 },
    ])
    vi.mocked(assignmentGet).mockResolvedValue({
      default_provider_id: 'p1', default_model: 'm',
      implement_provider_id: null, implement_model: null,
      research_provider_id: null, research_model: null,
      plan_provider_id: null, plan_model: null,
    })
    await useProvidersStore.getState().init()
    const s = useProvidersStore.getState()
    expect(s.providers).toHaveLength(1)
    expect(s.assignment?.default_provider_id).toBe('p1')
  })

  it('upsert persists then refreshes list', async () => {
    vi.mocked(providersUpsert).mockResolvedValue(undefined)
    vi.mocked(providersList).mockResolvedValue([])
    await useProvidersStore.getState().upsert({
      id: 'p1', label: 'L', endpoint: 'http://x',
      api_key: null, detected_json: null, health_json: null, position: 0,
    })
    expect(providersUpsert).toHaveBeenCalledTimes(1)
    expect(providersList).toHaveBeenCalled()
  })

  it('remove persists then refreshes list', async () => {
    vi.mocked(providersRemove).mockResolvedValue(undefined)
    vi.mocked(providersList).mockResolvedValue([])
    vi.mocked(assignmentGet).mockResolvedValue({} as never)
    await useProvidersStore.getState().remove('p1')
    expect(providersRemove).toHaveBeenCalledWith('p1')
  })

  it('setAssignment persists', async () => {
    vi.mocked(assignmentSet).mockResolvedValue(undefined)
    const a = {
      default_provider_id: 'p1', default_model: 'm',
      implement_provider_id: null, implement_model: null,
      research_provider_id: null, research_model: null,
      plan_provider_id: null, plan_model: null,
    }
    await useProvidersStore.getState().setAssignment(a)
    expect(assignmentSet).toHaveBeenCalledWith(a)
  })
})
