import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import type { DiffNode as DiffNodeType } from '@/types/nodes'
import { getNodeFlags } from './nodeUtils'
import { useCanvasStore } from '@/store/canvas'

export default memo(function DiffNode({ data }: NodeProps<DiffNodeType>) {
  const flags = getNodeFlags(data)
  const storeWidth = useCanvasStore((s) => s.codeNodeWidth)

  return (
    <div
      className={`relative pointer-events-auto bg-background border border-l-0 rounded-r-lg nodrag nopan ${flags.isFocused ? 'outline outline-2 outline-primary/60 border-primary/40' : 'border-border'} ${flags.isHidden ? 'opacity-30' : ''}`}
      style={{ width: storeWidth }}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50 bg-muted/30">
        <span className="text-xs font-medium text-foreground truncate">
          diff: {data.label}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-800/40 text-yellow-400 font-mono">
          {data.isNewFile ? 'new' : 'modified'}
        </span>
      </div>
      <div className="p-4 text-xs text-muted-foreground font-mono">
        diff pending...
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <Handle type="target" position={Position.Top} className="opacity-0" />
    </div>
  )
})
