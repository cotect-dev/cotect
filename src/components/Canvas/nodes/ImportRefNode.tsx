import { memo, useCallback, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { FileCode, FileText, FlaskConical, Image } from 'lucide-react'
import type { ImportRefNode, ImportRefItem } from '@/types/nodes'
import { getConfigForFile } from '@/services/treesitter-queries'
import { isImageFile } from '@/lib/fileClassification'
import { isTestFile } from '@/lib/fileClassification'
import { useCanvasStore } from '@/store/canvas'

// Must match CodeMirror line-height (18px) to keep ref nodes aligned with source lines.
export const REF_HEIGHT = 18

export function Pill({ item }: { item: ImportRefItem }) {
  const parseable = getConfigForFile(item.label) !== null
  const isTest = isTestFile(item.label)
  const isImg = isImageFile(item.label)
  const isImportedBy = item.kind === 'imported-by'

  const Icon = isTest ? FlaskConical : isImg ? Image : parseable ? FileCode : FileText
  const iconColor = isTest
    ? 'text-yellow-600/70'
    : isImg
      ? 'text-emerald-400/70'
      : isImportedBy
        ? 'text-violet-400/70'
        : 'text-green-400/70'

  const borderColor = isImportedBy
    ? 'border-violet-500/30 group-hover/ref:border-violet-400/50'
    : 'border-green-500/30 group-hover/ref:border-green-400/50'

  const [hovered, setHovered] = useState(false)

  const handleClick = useCallback(() => {
    void useCanvasStore.getState().focusFileByPath(item.resolvedPath)
  }, [item.resolvedPath])

  return (
    <div
      className={`pointer-events-auto flex items-center gap-1 rounded bg-background/90 px-1.5 border cursor-pointer
        ${borderColor} hover:bg-muted/40 transition-colors`}
      style={{ height: REF_HEIGHT - 4 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={handleClick}
    >
      <Icon className={`h-3 w-3 shrink-0 ${iconColor}`} />
      <span
        className={`text-[10px] leading-none text-foreground/55 hover:text-foreground/80 whitespace-nowrap transition-colors ${hovered ? '' : 'truncate max-w-[120px]'}`}
      >
        {hovered ? item.resolvedPath : item.label}
      </span>
    </div>
  )
}

export default memo(function ImportRefNode({ data }: NodeProps<ImportRefNode>) {
  const lineColor = data.items[0]?.kind === 'imported-by' ? 'bg-violet-400/20' : 'bg-green-400/20'

  return (
    <div className="flex items-center gap-0.5" style={{ height: REF_HEIGHT }}>
      {data.showConnector ? (
        <div className="flex items-center shrink-0" style={{ width: 28, marginLeft: -16 }}>
          <div className={`h-px flex-1 transition-colors ${lineColor}`} />
          <span className="text-[9px] text-muted-foreground/40 font-mono leading-none px-px">
            {data.line}
          </span>
          <div className={`h-px flex-1 transition-colors ${lineColor}`} />
        </div>
      ) : (
        <div className="w-3 shrink-0" />
      )}
      {data.items.map((item, idx) => (
        <Pill key={`${item.kind}:${item.resolvedPath}:${idx}`} item={item} />
      ))}
    </div>
  )
})
