// Stub artifact URLs until release hosting exists. Swap in one place.
export type OS = 'mac' | 'windows' | 'linux' | 'unknown'

export const DOWNLOADS = {
  windows: { label: 'Download for Windows', url: 'https://downloads.cotect.dev/cotect-setup.exe' },
  mac: { label: 'Download for macOS', url: 'https://downloads.cotect.dev/cotect.dmg' },
  linux: { appImageUrl: 'https://downloads.cotect.dev/cotect.AppImage' },
} as const

export function detectOS(platform?: string): OS {
  const p = platform ?? (typeof navigator !== 'undefined' ? navigator.platform : '')
  if (/mac/i.test(p)) return 'mac'
  if (/win/i.test(p)) return 'windows'
  if (/linux/i.test(p)) return 'linux'
  return 'unknown'
}
