import { memo, useCallback } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Folder } from 'lucide-react'
import { useCanvasStore } from '@/store'
import type { FolderNode } from '@/types/nodes'
import BaseNode from './BaseNode'
import { getNodeFlags, getNodeOpacity } from '.'

export default memo(function FolderNode({ id, data }: NodeProps<FolderNode>) {
  const flags = getNodeFlags(data)

  const handleClick = useCallback(() => useCanvasStore.getState().setFocus(id), [id])
  const handleDoubleClick = useCallback(() => {
    const store = useCanvasStore.getState()
    store.setFocus(id)
    void store.navigateRight()
  }, [id])

  const count = data.childCount

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
      badge={count != null ? String(count) : undefined}
    />
  )
})
