import { useEffect, useState } from 'react'
import { getPlatform } from '@/services/platform'
import type { AppInfo } from '@/services/platform/types'
import UpdateCheck from './UpdateCheck'

const LINKS: { label: string; url: string }[] = [
  { label: 'Website', url: 'https://cotect.dev' },
  { label: 'GitHub', url: 'https://github.com/cotect-dev/cotect' },
  { label: 'Releases', url: 'https://github.com/cotect-dev/cotect/releases' },
  { label: 'License', url: 'https://github.com/cotect-dev/cotect/blob/main/LICENSE' },
  { label: 'Report an issue', url: 'https://github.com/cotect-dev/cotect/issues' },
]

const OS_LABELS: Record<string, string> = {
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
  web: 'Web',
}

function platformLine(info: AppInfo): string {
  return [OS_LABELS[info.os] ?? info.os, info.build, info.arch].filter(Boolean).join(' · ')
}

export default function GeneralSection() {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    let active = true
    getPlatform()
      .app.info()
      .then((i) => active && setInfo(i))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">About</h2>
        <div className="flex flex-col gap-0.5">
          <div className="text-sm font-medium text-foreground">Cotect {info?.version ?? ''}</div>
          {info && platformLine(info) && (
            <div className="text-[11px] text-muted-foreground">{platformLine(info)}</div>
          )}
        </div>
        <UpdateCheck currentVersion={info?.version ?? ''} />
      </section>

      <section className="flex flex-col gap-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
          Links
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {LINKS.map((l) => (
            <button
              key={l.url}
              onClick={() => void getPlatform().app.openExternal(l.url)}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              {l.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
