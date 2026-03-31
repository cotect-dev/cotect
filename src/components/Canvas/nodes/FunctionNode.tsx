import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Braces } from 'lucide-react'
import type { FunctionNode } from '@/types/nodes'
import BaseNode from './BaseNode'

export default memo(function FunctionNode({ data }: NodeProps<FunctionNode>) {
  return (
    <BaseNode
      icon={Braces}
      iconClassName="text-emerald-400"
      label={data.label}
      badge="fn"
      className={data.isMethod ? 'ml-4' : ''}
    >
      <div className="text-xs text-muted-foreground mt-0.5">L{data.startLine}–{data.endLine}</div>
    </BaseNode>
  )
})
