import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Box } from 'lucide-react'

export default function ClassNode({ data }: NodeProps) {
  return (
    <div className="bg-background/90 backdrop-blur border border-purple-500/50 rounded-lg px-4 py-3 min-w-[180px]">
      <div className="flex items-center gap-2">
        <Box className="h-4 w-4 text-purple-400" />
        <span className="text-sm font-medium text-foreground truncate">{data.label as string}</span>
        <span className="text-xs text-muted-foreground">class</span>
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">
        L{data.startLine as number}–{data.endLine as number}
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <Handle type="target" position={Position.Top} className="opacity-0" />
    </div>
  )
}
