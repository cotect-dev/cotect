import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Box } from 'lucide-react'
import { useCanvasStore } from '@/store'
import type { ClassNode } from '@/types/nodes'
import BaseNode from './BaseNode'

export default memo(function ClassNode({ id, data }: NodeProps<ClassNode>) {
  const focusedNodeId = useCanvasStore((s) => s.focusedNodeId)
  const setFocus = useCanvasStore((s) => s.setFocus)
  const navigateRight = useCanvasStore((s) => s.navigateRight)
  const isCurrent = (data as Record<string, unknown>).__isCurrent as boolean | undefined

  return (
    <BaseNode
      icon={Box}
      iconClassName="text-purple-400"
      label={data.label}
      borderClassName="border-purple-500/50"
      className={`min-w-[150px] ${isCurrent === false ? 'opacity-50' : ''}`}
      badge="class"
      focused={focusedNodeId === id}
      onClick={() => setFocus(id)}
      onDoubleClick={() => {
        setFocus(id)
        navigateRight()
      }}
    />
  )
})
