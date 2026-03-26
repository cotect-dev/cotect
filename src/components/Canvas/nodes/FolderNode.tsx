import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Folder } from 'lucide-react'
import { useBrowserStore } from '@/store'

export default function FolderNode({ data }: NodeProps) {
  const navigateTo = useBrowserStore((s) => s.navigateTo)

  return (
    <div
      className="bg-background/90 backdrop-blur border border-border rounded-lg px-4 py-3 cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors min-w-[180px]"
      onClick={() => navigateTo(data.path as string, 'directory')}
    >
      <div className="flex items-center gap-2">
        <Folder className="h-4 w-4 text-yellow-500" />
        <span className="text-sm font-medium text-foreground truncate">{data.label as string}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <Handle type="target" position={Position.Top} className="opacity-0" />
    </div>
  )
}
