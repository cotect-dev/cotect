import { memo, useCallback } from 'react'
import type { NodeProps } from '@xyflow/react'
import { FileText, FileCode, FlaskConical, Image } from 'lucide-react'
import { useCanvasStore } from '@/store'
import { getConfigForFile } from '@/services/treesitter-queries'
import { isImageFile } from '@/lib/constants'
import type { FileNode } from '@/types/nodes'
import BaseNode from './BaseNode'
import { getNodeFlags } from '.'

export default memo(function FileNode({ id, data }: NodeProps<FileNode>) {
  const flags = getNodeFlags(data as Record<string, unknown>)
  const parseable = getConfigForFile(data.label) !== null
  const isTest = data.isTestFile === true
  const isPreview = id.startsWith('__preview__:')
  const isImage = isImageFile(data.label)

  const icon = isTest ? FlaskConical : isImage ? Image : parseable ? FileCode : FileText
  const iconColor = isTest ? 'text-yellow-600' : isImage ? 'text-emerald-400' : parseable ? 'text-blue-400' : 'text-muted-foreground'
  const border = isTest ? 'border-yellow-700/40 border-dashed' : 'border-border'

  const opacity = flags.isHidden ? 'opacity-30' : (!flags.isCurrent || isPreview) ? 'opacity-50' : ''

  const handleClick = useCallback(() => useCanvasStore.getState().setFocus(id), [id])
  const handleDoubleClick = useCallback(() => {
    const store = useCanvasStore.getState()
    store.setFocus(id)
    void store.navigateRight()
  }, [id])

  const canNavigate = parseable || isImage

  return (
    <BaseNode
      icon={icon}
      iconClassName={iconColor}
      label={data.label}
      borderClassName={border}
      className={`${opacity} ${isTest ? 'opacity-60' : ''}`}
      focused={flags.isFocused}
      onClick={handleClick}
      onDoubleClick={canNavigate ? handleDoubleClick : undefined}
    />
  )
})
