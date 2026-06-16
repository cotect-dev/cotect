import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import changelogText from '../../../CHANGELOG.md?raw'
import { getPlatform } from '@/services/platform'
import { sectionForVersion } from '@/lib/changelog'

const RELEASES_URL = 'https://github.com/cotect-dev/cotect/releases'
const PLUGINS = [remarkGfm]

// react-markdown emits bare HTML tags; style them as descendants so the notes
// match Settings' typography instead of falling back to browser defaults.
const PROSE =
  'flex flex-col gap-1 ' +
  '[&_h3]:text-xs [&_h3]:font-semibold [&_h3]:text-foreground [&_h3]:mt-4 [&_h3]:mb-1 ' +
  '[&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1 [&_ul]:pl-4 [&_ul]:list-disc [&_li]:marker:text-muted-foreground/40 ' +
  '[&_li]:text-xs [&_li]:text-muted-foreground [&_li]:leading-relaxed ' +
  '[&_p]:text-xs [&_p]:text-muted-foreground [&_p]:leading-relaxed ' +
  '[&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-2 ' +
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11px]'

export default function WhatsNewSection() {
  const [version, setVersion] = useState('')

  useEffect(() => {
    let active = true
    getPlatform()
      .app.info()
      .then((i) => active && setVersion(i.version))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  const section = useMemo(() => sectionForVersion(changelogText, version), [version])

  // Links inside the notes would navigate the WebView itself; route them to the
  // OS browser like the rest of the app does.
  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a')
    if (anchor?.href) {
      e.preventDefault()
      void getPlatform().app.openExternal(anchor.href)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-foreground">What&apos;s new</h2>
        {section && (
          <div className="text-[11px] text-muted-foreground">
            Version {section.version}
            {section.date ? ` · ${section.date}` : ''}
          </div>
        )}
      </section>

      {section && section.body ? (
        <div className={PROSE} onClick={handleClick}>
          <Markdown remarkPlugins={PLUGINS}>{section.body}</Markdown>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          No release notes are bundled for this build yet.
        </div>
      )}

      <button
        onClick={() => void getPlatform().app.openExternal(RELEASES_URL)}
        className="self-start text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
      >
        View full changelog
      </button>
    </div>
  )
}
