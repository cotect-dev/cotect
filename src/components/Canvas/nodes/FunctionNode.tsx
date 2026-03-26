import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Braces } from 'lucide-react'

export default function FunctionNode({ data }: NodeProps) {
  const isMethod = data.isMethod as boolean | undefined

  return (
    <div className={`bg-background/90 backdrop-blur border border-border rounded-lg px-4 py-3 min-w-[160px] ${isMethod ? 'ml-4' : ''}`}>
      <div className="flex items-center gap-2">
        <Braces className="h-3.5 w-3.5 text-emerald-400" />
        <span className="text-sm text-foreground truncate">{data.label as string}</span>
        <span className="text-xs text-muted-foreground">fn</span>
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">
        L{data.startLine as number}–{data.endLine as number}
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <Handle type="target" position={Position.Top} className="opacity-0" />
    </div>
  )
}
