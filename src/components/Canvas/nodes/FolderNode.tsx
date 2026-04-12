import { memo, useCallback } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Folder } from 'lucide-react'
import { useCanvasStore } from '@/store'
import type { FolderNode } from '@/types/nodes'
import BaseNode from './BaseNode'
import { getNodeFlags, getNodeOpacity } from './nodeUtils'

export default memo(function FolderNode({ id, data }: NodeProps<FolderNode>) {
  const flags = getNodeFlags(data)

  const handleClick = useCallback(() => useCanvasStore.getState().setFocus(id), [id])
  const handleDoubleClick = useCallback(() => {
    const store = useCanvasStore.getState()
    store.setFocus(id)
    void store.navigateRight()
  }, [id])

  return (
    <BaseNode
      icon={Folder}
      iconClassName="text-yellow-500"
      label={data.label}
      borderClassName="border-border border-2"
      className={getNodeOpacity(flags)}
      focused={flags.isFocused}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      badge={data.childCount != null ? String(data.childCount) : undefined}
    />
  )
})
