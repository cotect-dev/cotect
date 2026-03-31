import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { FileText, FileCode } from 'lucide-react'
import { useBrowserStore } from '@/store'
import { getConfigForFile } from '@/services/treesitter-queries'
import type { FileNode } from '@/types/nodes'
import BaseNode from './BaseNode'

export default memo(function FileNode({ data }: NodeProps<FileNode>) {
  const navigateTo = useBrowserStore((s) => s.navigateTo)
  const parseable = getConfigForFile(data.label) !== null

  return (
    <BaseNode
      icon={parseable ? FileCode : FileText}
      iconClassName={parseable ? 'text-blue-400' : 'text-muted-foreground'}
      label={data.label}
      borderClassName={data.isImport ? 'border-indigo-500/50 border-dashed' : 'border-border'}
      className="min-w-[180px]"
      onClick={parseable ? () => navigateTo(data.path, 'file') : undefined}
    >
      {data.isImport && data.declarationCount != null && (
        <div className="text-xs text-muted-foreground mt-1">{data.declarationCount} declarations</div>
      )}
    </BaseNode>
  )
})
