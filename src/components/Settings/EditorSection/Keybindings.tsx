import { useMemo, useState } from 'react'
import { KEYBINDINGS } from '@/lib/keybindings'

export default function Keybindings() {
  const [q, setQ] = useState('')
  const grouped = useMemo(() => {
    const lower = q.toLowerCase()
    const filtered = KEYBINDINGS.filter(
      (b) => b.label.toLowerCase().includes(lower) || b.chord.toLowerCase().includes(lower),
    )
    const map = new Map<string, typeof KEYBINDINGS>()
    for (const b of filtered) {
      const arr = map.get(b.group) ?? []
      arr.push(b)
      map.set(b.group, arr)
    }
    return [...map.entries()]
  }, [q])

  return (
    <div className="flex flex-col gap-2">
      <input
        className="h-7 px-2 text-xs rounded border border-border bg-background w-full"
        placeholder="Search shortcuts…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {grouped.map(([group, bindings]) => (
        <div key={group} className="flex flex-col">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium pt-2 pb-1">
            {group}
          </div>
          {bindings.map((b) => (
            <div key={b.id} className="flex items-center justify-between text-[11px] py-1">
              <span>{b.label}</span>
              <kbd className="font-mono text-[10px] px-1.5 py-0.5 bg-muted rounded border border-border">
                {b.chord}
              </kbd>
            </div>
          ))}
        </div>
      ))}
      {grouped.length === 0 && (
        <div className="text-[11px] text-muted-foreground py-3">No matches.</div>
      )}
    </div>
  )
}
