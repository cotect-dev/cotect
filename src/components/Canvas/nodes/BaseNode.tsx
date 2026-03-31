import type { ReactNode } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { LucideIcon } from 'lucide-react'

interface BaseNodeProps {
  icon: LucideIcon
  iconClassName?: string
  label: string
  borderClassName?: string
  className?: string
  onClick?: () => void
  badge?: string
  children?: ReactNode
}

export default function BaseNode({ icon: Icon, iconClassName, label, borderClassName = 'border-border', className = '', onClick, badge, children }: BaseNodeProps) {
  return (
    <div
      className={`bg-background/90 backdrop-blur border rounded-lg px-4 py-3 min-w-[160px] ${borderClassName} ${onClick ? 'cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors' : ''} ${className}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${iconClassName ?? 'text-muted-foreground'}`} />
        <span className="text-sm font-medium text-foreground truncate">{label}</span>
        {badge && <span className="text-xs text-muted-foreground">{badge}</span>}
      </div>
      {children}
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <Handle type="target" position={Position.Top} className="opacity-0" />
    </div>
  )
}
