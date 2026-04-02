import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { useCanvasStore } from '@/store'
import type { ProjectMetaNode } from '@/types/nodes'

export default memo(function ProjectMetaNode({ id, data }: NodeProps<ProjectMetaNode>) {
  const focusedNodeId = useCanvasStore((s) => s.focusedNodeId)
  const setFocus = useCanvasStore((s) => s.setFocus)
  const focused = focusedNodeId === id
  const isCurrent = (data as Record<string, unknown>).__isCurrent as boolean | undefined

  return (
    <div
      className={`bg-background/95 backdrop-blur border border-primary/30 rounded-xl px-4 py-3 min-w-[220px] max-w-[260px] shadow-lg shadow-primary/5 cursor-pointer transition-all duration-150 hover:border-primary/50 ${focused ? 'ring-2 ring-primary/60 bg-primary/10 scale-[1.02]' : ''} ${isCurrent === false ? 'opacity-50' : ''}`}
      onClick={() => setFocus(id)}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg font-bold text-foreground leading-tight">{data.name}</span>
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
