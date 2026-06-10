import { describe, it, expect, beforeEach } from 'vitest'
import { isDemoMode, setDemoMode } from '@/lib/demoMode'

describe('demoMode', () => {
  beforeEach(() => setDemoMode(false))

  it('defaults to off', () => {
    expect(isDemoMode()).toBe(false)
  })

  it('turns on once set', () => {
    setDemoMode(true)
    expect(isDemoMode()).toBe(true)
  })
})
