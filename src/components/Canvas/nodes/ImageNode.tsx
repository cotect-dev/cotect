import { memo, useCallback } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { Image } from 'lucide-react'
import { useCanvasStore } from '@/store'
import type { ImageNode } from '@/types/nodes'
import { getNodeFlags, getNodeOpacity } from './nodeUtils'

export default memo(function ImageNode({ id, data }: NodeProps<ImageNode>) {
  const flags = getNodeFlags(data)

  const handleClick = useCallback(() => useCanvasStore.getState().setFocus(id), [id])

  return (
    <div
      className={`bg-background/90 backdrop-blur border border-border rounded-lg p-2 ${flags.isFocused ? 'ring-2 ring-primary/60 bg-primary/10 scale-[1.02]' : ''} ${getNodeOpacity(flags)} cursor-pointer hover:border-primary/50 hover:bg-muted/50`}
      onClick={handleClick}
      style={{ maxWidth: '50vw' }}
    >
      <div className="flex items-center gap-2 mb-2 min-w-0 overflow-hidden px-1">
        <Image className="h-4 w-4 shrink-0 text-emerald-400" />
        <span className="text-sm font-medium text-foreground truncate min-w-0">{data.label}</span>
      </div>
      <img
        src={data.dataUrl}
        alt={data.label}
        className="rounded max-w-[400px] max-h-[400px] object-contain"
        draggable={false}
      />
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <Handle type="target" position={Position.Top} className="opacity-0" />
    </div>
  )
})
