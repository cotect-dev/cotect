// Artifacts live in this repo's GitHub releases; the release workflow
// uploads them under these fixed names, so `latest` always points at the
// newest build.
export const REPO_URL = 'https://github.com/cotect-dev/cotect'
const RELEASES = `${REPO_URL}/releases/latest/download`

export type OS = 'mac' | 'windows' | 'linux' | 'unknown'

export const DOWNLOADS = {
  windows: { label: 'Download for Windows', url: `${RELEASES}/cotect-setup.exe` },
  mac: { label: 'Download for macOS', url: `${RELEASES}/cotect.dmg` },
  linux: {
    debUrl: `${RELEASES}/cotect-amd64.deb`,
    rpmUrl: `${RELEASES}/cotect-x86_64.rpm`,
    appImageUrl: `${RELEASES}/cotect.AppImage`,
  },
} as const

export function detectOS(platform?: string): OS {
  const p =
    platform ??
    (typeof navigator !== 'undefined'
      ? ((navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
        navigator.platform)
      : '')
  if (/mac/i.test(p)) return 'mac'
  if (/win/i.test(p)) return 'windows'
  if (/linux/i.test(p)) return 'linux'
  return 'unknown'
}

export type LinuxPkg = 'deb' | 'rpm'

// The browser does not reliably expose the Linux distro (Chrome sends a generic
// "Linux x86_64"). Firefox includes a vendor token, so we can spot rpm-based
// distros when it is present; everything else defaults to .deb, which covers
// the Debian/Ubuntu family that dominates desktop Linux.
export function detectLinuxPkg(ua?: string): LinuxPkg {
  const s = ua ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '')
  if (/fedora|red ?hat|rhel|suse|mandriva|mageia/i.test(s)) return 'rpm'
  return 'deb'
}
