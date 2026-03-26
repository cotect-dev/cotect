import { Handle, Position, type NodeProps } from '@xyflow/react'
import { FileText, FileCode } from 'lucide-react'
import { useBrowserStore } from '@/store'
import { getConfigForFile } from '@/services/treesitter-queries'

export default function FileNode({ data }: NodeProps) {
  const navigateTo = useBrowserStore((s) => s.navigateTo)
  const parseable = getConfigForFile(data.label as string) !== null
  const isImport = data.isImport as boolean | undefined
  const Icon = parseable ? FileCode : FileText

  return (
    <div
      className={`bg-background/90 backdrop-blur border rounded-lg px-4 py-3 min-w-[180px] transition-colors ${
        parseable ? 'cursor-pointer hover:border-primary/50 hover:bg-muted/50' : ''
      } ${isImport ? 'border-indigo-500/50 border-dashed' : 'border-border'}`}
      onClick={() => {
        if (parseable) navigateTo(data.path as string, 'file')
      }}
    >
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${parseable ? 'text-blue-400' : 'text-muted-foreground'}`} />
        <span className="text-sm font-medium text-foreground truncate">{data.label as string}</span>
      </div>
      {isImport && data.declarationCount != null && (
        <div className="text-xs text-muted-foreground mt-1">{String(data.declarationCount)} declarations</div>
      )}
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <Handle type="target" position={Position.Top} className="opacity-0" />
    </div>
  )
}
