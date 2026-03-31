import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Folder } from 'lucide-react'
import { useBrowserStore } from '@/store'
import type { FolderNode } from '@/types/nodes'
import BaseNode from './BaseNode'

export default memo(function FolderNode({ data }: NodeProps<FolderNode>) {
  const navigateTo = useBrowserStore((s) => s.navigateTo)
  return (
    <BaseNode
      icon={Folder}
      iconClassName="text-yellow-500"
      label={data.label}
      className="min-w-[180px]"
      onClick={() => navigateTo(data.path, 'directory')}
    />
  )
})
