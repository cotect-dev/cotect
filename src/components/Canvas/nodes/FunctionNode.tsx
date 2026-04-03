import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Braces } from 'lucide-react'
import { useCanvasStore } from '@/store'
import type { FunctionNode } from '@/types/nodes'
import BaseNode from './BaseNode'

export default memo(function FunctionNode({ id, data }: NodeProps<FunctionNode>) {
  const focusedNodeId = useCanvasStore((s) => s.focusedNodeId)
  const setFocus = useCanvasStore((s) => s.setFocus)
  const navigateRight = useCanvasStore((s) => s.navigateRight)
  const isCurrent = (data as Record<string, unknown>).__isCurrent as boolean | undefined
  const isHidden = (data as Record<string, unknown>).__isHidden as boolean | undefined

  return (
    <BaseNode
      icon={Braces}
      iconClassName="text-emerald-400"
      label={data.label}
      badge="fn"
      className={`${data.isMethod ? 'ml-4' : ''} ${isHidden ? 'opacity-30' : isCurrent === false ? 'opacity-50' : ''}`}
      focused={focusedNodeId === id}
      onClick={() => setFocus(id)}
      onDoubleClick={() => {
        setFocus(id)
        navigateRight()
      }}
    >
      <div className="text-xs text-muted-foreground mt-0.5">L{data.startLine}–{data.endLine}</div>
    </BaseNode>
  )
})
