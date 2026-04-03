import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Folder } from 'lucide-react'
import { useCanvasStore } from '@/store'
import type { FolderNode } from '@/types/nodes'
import BaseNode from './BaseNode'

export default memo(function FolderNode({ id, data }: NodeProps<FolderNode>) {
  const focusedNodeId = useCanvasStore((s) => s.focusedNodeId)
  const setFocus = useCanvasStore((s) => s.setFocus)
  const navigateRight = useCanvasStore((s) => s.navigateRight)
  const isCurrent = (data as Record<string, unknown>).__isCurrent as boolean | undefined
  const isHidden = (data as Record<string, unknown>).__isHidden as boolean | undefined

  return (
    <BaseNode
      icon={Folder}
      iconClassName="text-yellow-500"
      label={data.label}
      className={`${isHidden ? 'opacity-30' : isCurrent === false ? 'opacity-50' : ''}`}
      focused={focusedNodeId === id}
      onClick={() => setFocus(id)}
      onDoubleClick={() => {
        setFocus(id)
        navigateRight()
      }}
    />
  )
})
