import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { FileText, FileCode } from 'lucide-react'
import { useCanvasStore } from '@/store'
import { getConfigForFile } from '@/services/treesitter-queries'
import type { FileNode } from '@/types/nodes'
import BaseNode from './BaseNode'

export default memo(function FileNode({ id, data }: NodeProps<FileNode>) {
  const focusedNodeId = useCanvasStore((s) => s.focusedNodeId)
  const setFocus = useCanvasStore((s) => s.setFocus)
  const navigateRight = useCanvasStore((s) => s.navigateRight)
  const parseable = getConfigForFile(data.label) !== null
  const isCurrent = (data as Record<string, unknown>).__isCurrent as boolean | undefined

  return (
    <BaseNode
      icon={parseable ? FileCode : FileText}
      iconClassName={parseable ? 'text-blue-400' : 'text-muted-foreground'}
      label={data.label}
      borderClassName={data.isImport ? 'border-indigo-500/50 border-dashed' : 'border-border'}
      className={`min-w-[150px] ${isCurrent === false ? 'opacity-50' : ''}`}
      focused={focusedNodeId === id}
      onClick={() => setFocus(id)}
      onDoubleClick={parseable && !data.isImport ? () => {
        setFocus(id)
        navigateRight()
      } : undefined}
    >
      {data.isImport && data.declarationCount != null && (
        <div className="text-xs text-muted-foreground mt-1">{data.declarationCount} declarations</div>
      )}
    </BaseNode>
  )
})
