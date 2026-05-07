import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AddProviderRow from './AddProviderRow'

vi.mock('@/services/agent', () => ({ probeProvider: vi.fn() }))
vi.mock('@/store/providers', () => ({
  useProvidersStore: Object.assign(
    (selector: (s: { upsert: typeof upsertSpy }) => unknown) => selector({ upsert: upsertSpy }),
    { getState: () => ({ upsert: upsertSpy }) },
  ),
}))

import { probeProvider } from '@/services/agent'
const upsertSpy = vi.fn()

describe('AddProviderRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsertSpy.mockReset()
  })

  it('disables Connect when endpoint is empty', () => {
    render(<AddProviderRow />)
    expect(screen.getByRole('button', { name: /connect/i })).toBeDisabled()
  })

  it('calls probeProvider with normalized input on Connect', async () => {
    vi.mocked(probeProvider).mockResolvedValue({
      normalized_endpoint: 'http://localhost:11434/v1',
      server_type: 'Ollama',
      models: [{ id: 'llama3', family: 'Llama-3', context: 8192 }],
      capabilities: ['streaming', 'tool-calls'],
      format_per_model: { llama3: 'llama3' },
      probe_ms: 120,
    })
    render(<AddProviderRow />)
    fireEvent.change(screen.getByPlaceholderText(/host:port/i), { target: { value: 'localhost:11434' } })
    fireEvent.click(screen.getByRole('button', { name: /connect/i }))
    await waitFor(() => expect(probeProvider).toHaveBeenCalledWith({ endpoint: 'localhost:11434', api_key: null }))
  })

  it('persists provider via upsert after successful probe', async () => {
    vi.mocked(probeProvider).mockResolvedValue({
      normalized_endpoint: 'http://localhost:11434/v1',
      server_type: 'Ollama', models: [], capabilities: [], format_per_model: {}, probe_ms: 100,
    })
    render(<AddProviderRow />)
    fireEvent.change(screen.getByPlaceholderText(/host:port/i), { target: { value: 'localhost:11434' } })
    fireEvent.click(screen.getByRole('button', { name: /connect/i }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    const arg = upsertSpy.mock.calls[0][0]
    expect(arg.endpoint).toBe('http://localhost:11434/v1')
    expect(arg.label).toContain('Ollama')
  })

  it('shows diagnostic when probe fails', async () => {
    vi.mocked(probeProvider).mockRejectedValue('endpoint unreachable\n\nIs the server running on :11434?')
    render(<AddProviderRow />)
    fireEvent.change(screen.getByPlaceholderText(/host:port/i), { target: { value: 'localhost:11434' } })
    fireEvent.click(screen.getByRole('button', { name: /connect/i }))
    await waitFor(() => expect(screen.getByText(/Is the server running on :11434/)).toBeInTheDocument())
  })
})
