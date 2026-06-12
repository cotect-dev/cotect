import { useState } from 'react'
import { RefreshCw, Check, Download, AlertCircle } from 'lucide-react'
import { relaunch } from '@tauri-apps/plugin-process'
import type { Update } from '@tauri-apps/plugin-updater'
import { getUpdateStatus } from '@/services/updater'
import { getPlatform } from '@/services/platform'

type State =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'upToDate' }
  | { kind: 'available'; version: string; selfUpdatable: boolean; update: Update }
  | { kind: 'installing'; percent: number }
  | { kind: 'error' }

const DOWNLOAD_URL = 'https://cotect.dev'

export default function UpdateCheck({ currentVersion }: { currentVersion: string }) {
  const [state, setState] = useState<State>({ kind: 'idle' })

  async function check() {
    setState({ kind: 'checking' })
    try {
      const { selfUpdatable, update } = await getUpdateStatus()
      if (!update) {
        setState({ kind: 'upToDate' })
        return
      }
      setState({ kind: 'available', version: update.version, selfUpdatable, update })
    } catch {
      setState({ kind: 'error' })
    }
  }

  async function install(update: Update) {
    setState({ kind: 'installing', percent: 0 })
    try {
      let total = 0
      let received = 0
      await update.downloadAndInstall((e) => {
        if (e.event === 'Started') {
          total = e.data.contentLength ?? 0
        } else if (e.event === 'Progress') {
          received += e.data.chunkLength
          if (total > 0) {
            setState({
              kind: 'installing',
              percent: Math.min(100, Math.round((received / total) * 100)),
            })
          }
        }
      })
      await relaunch()
    } catch {
      setState({ kind: 'error' })
    }
  }

  const button =
    'inline-flex items-center gap-1.5 h-7 px-2.5 text-xs rounded border border-border ' +
    'text-foreground hover:bg-muted transition-colors disabled:opacity-60 disabled:cursor-default'

  switch (state.kind) {
    case 'idle':
      return (
        <button className={button} onClick={check}>
          <RefreshCw className="h-3.5 w-3.5" />
          Check for updates
        </button>
      )

    case 'checking':
      return (
        <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          Checking…
        </div>
      )

    case 'upToDate':
      return (
        <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="h-3.5 w-3.5 text-green-500" />
          You&rsquo;re on the latest version{currentVersion ? ` (${currentVersion})` : ''}.
        </div>
      )

    case 'available':
      return (
        <div className="flex flex-col gap-1.5">
          <div className="text-xs text-foreground">Cotect {state.version} is available.</div>
          {state.selfUpdatable ? (
            <button className={button} onClick={() => void install(state.update)}>
              <Download className="h-3.5 w-3.5" />
              Install and restart
            </button>
          ) : (
            <button
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 self-start"
              onClick={() => void getPlatform().app.openExternal(DOWNLOAD_URL)}
            >
              Get it from cotect.dev or your package manager
            </button>
          )}
        </div>
      )

    case 'installing':
      return (
        <div className="flex flex-col gap-1.5 w-56">
          <div className="text-xs text-muted-foreground">Downloading… {state.percent}%</div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-foreground/70 transition-[width] duration-150"
              style={{ width: `${state.percent}%` }}
            />
          </div>
        </div>
      )

    case 'error':
      return (
        <div className="flex flex-col gap-1.5 items-start">
          <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertCircle className="h-3.5 w-3.5 text-red-400" />
            Couldn&rsquo;t check for updates.
          </div>
          <button className={button} onClick={check}>
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      )
  }
}
