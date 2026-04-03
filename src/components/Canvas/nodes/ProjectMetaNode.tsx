import { memo, useCallback } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { useCanvasStore } from '@/store'
import type { ProjectMetaNode } from '@/types/nodes'
import { getNodeFlags, getNodeOpacity } from '.'

export default memo(function ProjectMetaNode({ id, data }: NodeProps<ProjectMetaNode>) {
  const flags = getNodeFlags(data as Record<string, unknown>)

  const handleClick = useCallback(() => useCanvasStore.getState().setFocus(id), [id])

  return (
    <div
      className={`bg-background/95 backdrop-blur border border-primary/30 rounded-xl px-4 py-3 w-[180px] max-w-[180px] overflow-hidden shadow-lg shadow-primary/5 cursor-pointer transition-all duration-150 hover:border-primary/50 ${flags.isFocused ? 'ring-2 ring-primary/60 bg-primary/10 scale-[1.02]' : ''} ${getNodeOpacity(flags)}`}
      onClick={handleClick}
    >
      <div className="flex items-center gap-2 mb-1 min-w-0 overflow-hidden">
        <span className="text-base font-bold text-foreground leading-tight truncate">{data.name}</span>
      </div>
      {data.description && (
        <p className="text-xs text-muted-foreground leading-relaxed mb-2 line-clamp-2">
          {data.description}
        </p>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">
        {data.version && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-mono">
            v{data.version}
          </span>
        )}
        {data.language && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-400 font-medium">
            {data.language}
          </span>
        )}
        {data.framework && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-purple-500/10 text-purple-400 font-medium">
            {data.framework}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <Handle type="target" position={Position.Top} className="opacity-0" />
    </div>
  )
})
