import { memo, useEffect, useMemo, useState, type ComponentProps } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getPlatform } from '@/services/platform'
import { getImageMimeType, isImageFile } from '@/lib/constants'

const PLUGINS = [remarkGfm]

function isLocalPath(src: string): boolean {
  return !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:')
}

function resolveRelative(base: string, rel: string): string {
  const dir = base.slice(0, base.lastIndexOf('/'))
  if (rel.startsWith('/')) return rel
  const parts = dir.split('/')
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.' && seg !== '') parts.push(seg)
  }
  return parts.join('/')
}

type ImageState = { path: string; dataUrl: string } | { path: string; error: true } | null

function LocalImage({ src, alt, dir }: { src: string; alt?: string; dir: string }) {
  const absPath = useMemo(() => resolveRelative(dir, src), [dir, src])
  const isImage = isImageFile(absPath)
  const [state, setState] = useState<ImageState>(null)

  useEffect(() => {
    if (!isImage) return
    let cancelled = false

    getPlatform()
      .fs.readBinaryFile(absPath)
      .then((bytes) => {
        if (cancelled) return
        const mime = getImageMimeType(absPath)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i])
        }
        setState({ path: absPath, dataUrl: `data:${mime};base64,${btoa(binary)}` })
      })
      .catch(() => {
        if (!cancelled) setState({ path: absPath, error: true })
      })

    return () => {
      cancelled = true
    }
  }, [absPath, isImage])

  if (!isImage) {
    return (
      <span className="inline-block text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
        {alt || src} (unsupported format)
      </span>
    )
  }

  const current = state?.path === absPath ? state : null

  if (current && 'error' in current) {
    return (
      <span className="inline-block text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
        {alt || src} (image not found)
      </span>
    )
  }

  if (!current) {
    return <span className="inline-block text-xs text-muted-foreground animate-pulse">{alt}…</span>
  }

  return <img src={current.dataUrl} alt={alt} className="rounded-md max-w-full" draggable={false} />
}

export default memo(function MarkdownPreview({
  content,
  filePath,
  maxHeight,
}: {
  content: string
  filePath: string
  maxHeight: string
}) {
  const components = useMemo(
    (): ComponentProps<typeof Markdown>['components'] => ({
      img: ({ src, alt }) => {
        if (!src || !isLocalPath(src)) {
          return <img src={src} alt={alt} className="rounded-md max-w-full" draggable={false} />
        }
        return <LocalImage src={src} alt={alt} dir={filePath} />
      },
    }),
    [filePath],
  )

  return (
    <div
      className="nowheel overflow-y-auto prose prose-invert prose-sm
        max-w-none px-4 py-3
        prose-headings:text-foreground prose-headings:font-semibold
        prose-headings:mt-4 prose-headings:mb-2
        prose-p:text-foreground/80 prose-p:my-1.5 prose-p:leading-relaxed
        prose-a:text-primary prose-a:no-underline hover:prose-a:underline
        prose-strong:text-foreground prose-em:text-foreground/70
        prose-code:text-primary prose-code:bg-muted prose-code:px-1
        prose-code:py-0.5 prose-code:rounded prose-code:text-xs
        prose-code:before:content-none prose-code:after:content-none
        prose-pre:bg-muted prose-pre:rounded-md prose-pre:p-3
        prose-pre:text-xs prose-pre:overflow-x-auto
        prose-blockquote:border-l-primary/40 prose-blockquote:text-foreground/60
        prose-li:text-foreground/80 prose-li:my-0.5
        prose-hr:border-border
        prose-table:text-xs
        prose-th:text-foreground prose-th:border-border prose-th:px-2 prose-th:py-1
        prose-td:text-foreground/80 prose-td:border-border prose-td:px-2 prose-td:py-1
        prose-img:rounded-md prose-img:max-w-full"
      style={{ maxHeight, overscrollBehavior: 'contain' }}
    >
      <Markdown remarkPlugins={PLUGINS} components={components}>
        {content}
      </Markdown>
    </div>
  )
})
