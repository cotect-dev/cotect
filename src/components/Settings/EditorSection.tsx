import { usagePurge } from '@/services/db'
import { Button } from '@/components/ui/button'
import Keybindings from './EditorSection/Keybindings'

export default function EditorSection() {
  const onClearUsage = async () => {
    if (!confirm('Permanently delete all usage records? This cannot be undone.')) return
    await usagePurge(Date.now() + 1)
  }

  return (
    <div className="flex flex-col">
      <h2 className="text-sm font-semibold text-foreground mb-2">Editor</h2>

      <div className="flex flex-col gap-2 py-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Keybindings</div>
        <Keybindings />
      </div>

      <div className="flex flex-col gap-1.5 py-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Storage</div>
        <div className="grid grid-cols-[140px_1fr] gap-x-4 items-center text-[11px]">
          <span className="text-foreground">Clear all usage data</span>
          <div>
            <Button size="sm" variant="ghost" onClick={onClearUsage}
              className="h-6 px-2 text-[11px] text-red-400 hover:text-red-300">Clear</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
