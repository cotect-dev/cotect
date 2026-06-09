import { HelpCircle } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { navigateToFile } from './navigateToFile'
import { shortPath } from './format'

export function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger className="inline-flex cursor-help">
        <HelpCircle className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

/** Section wrapper: title, optional subtitle/tooltip, and content. */
export function Section({
  title,
  subtitle,
  tooltip,
  right,
  children,
}: {
  title: string
  subtitle?: string
  tooltip?: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {tooltip && <InfoTip text={tooltip} />}
        <div className="flex-1" />
        {right}
      </div>
      {subtitle && <p className="-mt-1 text-xs text-muted-foreground">{subtitle}</p>}
      {children}
    </section>
  )
}

/** A clickable file path that navigates to the Files view. */
export function FileLink({
  path,
  label,
  className = '',
}: {
  path: string
  label?: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={() => navigateToFile(path)}
      className={`block w-full truncate text-left font-mono text-foreground/80 hover:text-primary cursor-pointer ${className}`}
      title={path}
    >
      {label ?? shortPath(path)}
    </button>
  )
}
