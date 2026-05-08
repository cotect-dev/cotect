import { memo, useCallback } from 'react'
import type { NodeProps } from '@xyflow/react'
import { FileCode, FileText, FlaskConical, Image } from 'lucide-react'
import type { ImportRefNode } from '@/types/nodes'
import { getConfigForFile } from '@/services/treesitter-queries'
import { isImageFile } from '@/lib/constants'
import { useCanvasStore } from '@/store/canvas'

function isTestFile(name: string): boolean {
  const lower = name.toLowerCase()
  if (/\.(test|spec)\.\w+$/.test(lower)) return true
  if (/[_-]test\.\w+$/.test(lower)) return true
  return false
}

/**
 * Height must exactly match the pinned CodeMirror line-height (18px) so that
 * ref nodes stay aligned 1:1 with source lines without cumulative drift.
 */
const REF_HEIGHT = 18

export default memo(function ImportRefNode({ data }: NodeProps<ImportRefNode>) {
  const parseable = getConfigForFile(data.label) !== null
  const isTest = isTestFile(data.label)
  const isImg = isImageFile(data.label)
  const isImportedBy = data.kind === 'imported-by'

  const Icon = isTest ? FlaskConical : isImg ? Image : parseable ? FileCode : FileText
  const iconColor = isTest
    ? 'text-yellow-600/70'
    : isImg
      ? 'text-emerald-400/70'
      : isImportedBy
        ? 'text-violet-400/70'
        : parseable
          ? 'text-blue-400/70'
          : 'text-muted-foreground/70'

  const borderColor = isImportedBy
    ? 'border-violet-500/30 group-hover/ref:border-violet-400/50'
    : 'border-border/40 group-hover/ref:border-primary/40'

  const lineColor = isImportedBy
    ? 'bg-violet-400/20 group-hover/ref:bg-violet-400/40'
    : 'bg-foreground/10 group-hover/ref:bg-foreground/25'

  const handleClick = useCallback(() => {
    void useCanvasStore.getState().focusFileByPath(data.resolvedPath)
  }, [data.resolvedPath])

  return (
    <div
      className="pointer-events-auto flex items-center cursor-pointer group/ref"
      style={{ height: REF_HEIGHT }}
      onClick={handleClick}
    >
      {/* Leading connector line */}
      <div className={`w-3 h-px shrink-0 transition-colors ${lineColor}`} />
      {/* Pill */}
      <div
        className={`flex items-center gap-1 rounded bg-background/90 px-1.5 border ${borderColor} group-hover/ref:bg-muted/40 transition-colors`}
        style={{ height: REF_HEIGHT - 4 }}
      >
        <Icon className={`h-3 w-3 shrink-0 ${iconColor}`} />
        <span className="text-[10px] leading-none text-foreground/55 group-hover/ref:text-foreground/80 truncate whitespace-nowrap transition-colors max-w-[120px]">
          {data.label}
        </span>
      </div>
    </div>
  )
})
