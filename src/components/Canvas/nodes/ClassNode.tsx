import { memo, useCallback } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Box } from 'lucide-react'
import { useCanvasStore } from '@/store'
import type { ClassNode } from '@/types/nodes'
import BaseNode from './BaseNode'
import { getNodeFlags, getNodeOpacity } from '.'

export default memo(function ClassNode({ id, data }: NodeProps<ClassNode>) {
  const flags = getNodeFlags(data as Record<string, unknown>)

  const handleClick = useCallback(() => useCanvasStore.getState().setFocus(id), [id])
  const handleDoubleClick = useCallback(() => {
    const store = useCanvasStore.getState()
    store.setFocus(id)
    store.navigateRight()
  }, [id])

  return (
    <BaseNode
      icon={Box}
      iconClassName="text-purple-400"
      label={data.label}
      borderClassName="border-purple-500/50"
      className={getNodeOpacity(flags)}
      badge="class"
      focused={flags.isFocused}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <div className="text-xs text-muted-foreground mt-0.5">L{data.startLine}–{data.endLine}</div>
    </BaseNode>
  )
})
