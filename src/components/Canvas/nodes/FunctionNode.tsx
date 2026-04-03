import { memo, useCallback } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Braces } from 'lucide-react'
import { useCanvasStore } from '@/store'
import type { FunctionNode } from '@/types/nodes'
import BaseNode from './BaseNode'
import { getNodeFlags, getNodeOpacity } from '.'

export default memo(function FunctionNode({ id, data }: NodeProps<FunctionNode>) {
  const flags = getNodeFlags(data as Record<string, unknown>)

  const handleClick = useCallback(() => useCanvasStore.getState().setFocus(id), [id])
  const handleDoubleClick = useCallback(() => {
    const store = useCanvasStore.getState()
    store.setFocus(id)
    store.navigateRight()
  }, [id])

  return (
    <BaseNode
      icon={Braces}
      iconClassName="text-emerald-400"
      label={data.label}
      badge="fn"
      className={`${data.isMethod ? 'ml-4' : ''} ${getNodeOpacity(flags)}`}
      focused={flags.isFocused}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <div className="text-xs text-muted-foreground mt-0.5">L{data.startLine}–{data.endLine}</div>
    </BaseNode>
  )
})
