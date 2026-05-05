import { describe, it, expect } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('handles conditional classes', () => {
    const isHidden = false as boolean
    expect(cn('base', isHidden && 'hidden', 'visible')).toBe('base visible')
  })

  it('merges conflicting tailwind classes', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2')
  })
})
