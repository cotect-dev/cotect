import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  getUpdateStatus: vi.fn(),
  openExternal: vi.fn(),
  relaunch: vi.fn(),
}))

vi.mock('@/services/updater', () => ({ getUpdateStatus: mocks.getUpdateStatus }))
vi.mock('@/services/platform', () => ({
  getPlatform: () => ({ app: { openExternal: mocks.openExternal } }),
}))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: mocks.relaunch }))

import UpdateCheck from './UpdateCheck'

beforeEach(() => vi.clearAllMocks())

describe('UpdateCheck', () => {
  it('reports being up to date when no update is returned', async () => {
    mocks.getUpdateStatus.mockResolvedValue({ selfUpdatable: true, update: null })
    render(<UpdateCheck currentVersion="0.2.0" />)
    fireEvent.click(screen.getByText('Check for updates'))
    expect(await screen.findByText(/latest version \(0\.2\.0\)/)).toBeInTheDocument()
  })

  it('offers install-and-restart for self-updatable installs', async () => {
    mocks.getUpdateStatus.mockResolvedValue({
      selfUpdatable: true,
      update: { version: '0.3.0' },
    })
    render(<UpdateCheck currentVersion="0.2.0" />)
    fireEvent.click(screen.getByText('Check for updates'))
    expect(await screen.findByText(/Cotect 0\.3\.0 is available/)).toBeInTheDocument()
    expect(screen.getByText('Install and restart')).toBeInTheDocument()
  })

  it('shows a download link instead of install for package-managed installs', async () => {
    mocks.getUpdateStatus.mockResolvedValue({
      selfUpdatable: false,
      update: { version: '0.3.0' },
    })
    render(<UpdateCheck currentVersion="0.2.0" />)
    fireEvent.click(screen.getByText('Check for updates'))
    expect(await screen.findByText(/package manager/)).toBeInTheDocument()
    expect(screen.queryByText('Install and restart')).not.toBeInTheDocument()
  })

  it('surfaces an error with a retry when the check throws', async () => {
    mocks.getUpdateStatus.mockRejectedValue(new Error('offline'))
    render(<UpdateCheck currentVersion="0.2.0" />)
    fireEvent.click(screen.getByText('Check for updates'))
    expect(await screen.findByText(/Couldn.t check for updates/)).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })
})
