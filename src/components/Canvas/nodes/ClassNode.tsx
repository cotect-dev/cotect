import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Box } from 'lucide-react'
import type { ClassNode } from '@/types/nodes'
import BaseNode from './BaseNode'

export default memo(function ClassNode({ data }: NodeProps<ClassNode>) {
  return (
    <BaseNode
      icon={Box}
      iconClassName="text-purple-400"
      label={data.label}
      borderClassName="border-purple-500/50"
      className="min-w-[180px]"
      badge="class"
    >
      <div className="text-xs text-muted-foreground mt-0.5">L{data.startLine}–{data.endLine}</div>
    </BaseNode>
  )
})
