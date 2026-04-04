import { memo, type ReactNode } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { LucideIcon } from 'lucide-react'

interface BaseNodeProps {
  icon: LucideIcon
  iconClassName?: string
  label: string
  borderClassName?: string
  className?: string
  onClick?: () => void
  onDoubleClick?: () => void
  badge?: string
  focused?: boolean
  children?: ReactNode
}

export default memo(function BaseNode({ icon: Icon, iconClassName, label, borderClassName = 'border-border', className = '', onClick, onDoubleClick, badge, focused, children }: BaseNodeProps) {
  const focusRing = focused ? 'ring-2 ring-primary/60 bg-primary/10 scale-[1.02]' : ''
  return (
    <div
      className={`bg-background/90 backdrop-blur border rounded-lg px-3 py-2 w-[180px] max-w-[180px] transition-all duration-150 ${borderClassName} ${onClick || onDoubleClick ? 'cursor-pointer hover:border-primary/50 hover:bg-muted/50' : ''} ${focusRing} ${className}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <div className={`flex items-center gap-2 min-w-0 overflow-hidden ${badge ? 'justify-between' : ''}`}>
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          <Icon className={`h-4 w-4 shrink-0 ${iconClassName ?? 'text-muted-foreground'}`} />
          <span className="text-sm font-medium text-foreground truncate min-w-0">{label}</span>
        </div>
        {badge && <span className="text-xs text-muted-foreground shrink-0">{badge}</span>}
      </div>
      {children}
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <Handle type="target" position={Position.Top} className="opacity-0" />
    </div>
  )
})
