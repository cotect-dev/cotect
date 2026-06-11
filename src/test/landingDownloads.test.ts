import { describe, it, expect } from 'vitest'
import { detectOS, DOWNLOADS } from '../../landing/downloads'

describe('detectOS', () => {
  it.each([
    ['MacIntel', 'mac'],
    ['Win32', 'windows'],
    ['Linux x86_64', 'linux'],
    ['FreeBSD amd64', 'unknown'],
  ])('maps platform %s to %s', (platform, expected) => {
    expect(detectOS(platform)).toBe(expected)
  })
})

describe('DOWNLOADS', () => {
  it('has windows and mac artifact urls and a linux appimage url', () => {
    expect(DOWNLOADS.windows.url).toMatch(/^https?:\/\//)
    expect(DOWNLOADS.mac.url).toMatch(/^https?:\/\//)
    expect(DOWNLOADS.linux.appImageUrl).toMatch(/^https?:\/\//)
  })
})
