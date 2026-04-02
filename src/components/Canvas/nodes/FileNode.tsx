import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { FileText, FileCode, FlaskConical } from 'lucide-react'
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
  const isTest = data.isTestFile === true
  const isPreview = id.startsWith('__preview__:')

  const icon = isTest ? FlaskConical : parseable ? FileCode : FileText
  const iconColor = isTest ? 'text-yellow-600' : parseable ? 'text-blue-400' : 'text-muted-foreground'
  const border = data.isImport
    ? 'border-indigo-500/50 border-dashed'
    : isTest
      ? 'border-yellow-700/40 border-dashed'
      : 'border-border'

  return (
    <BaseNode
      icon={icon}
      iconClassName={iconColor}
      label={data.label}
      borderClassName={border}
      className={`min-w-[150px] ${isCurrent === false || isPreview ? 'opacity-50' : ''} ${isTest ? 'opacity-60' : ''}`}
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
