import { describe, it, expect, afterEach } from 'vitest'
import { isDemoMode, setDemoMode } from './demoMode'

describe('demoMode', () => {
  afterEach(() => setDemoMode(false))

  it('is off until set', () => {
    expect(isDemoMode()).toBe(false)
  })

  it('turns on once set', () => {
    setDemoMode(true)
    expect(isDemoMode()).toBe(true)
  })
})
