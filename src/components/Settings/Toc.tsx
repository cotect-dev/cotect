import { useEffect, useState } from 'react'

interface TocItem { id: string; label: string }

const TOC: TocItem[] = [
  { id: 'providers', label: 'Providers' },
  { id: 'agent',     label: 'Agent' },
  { id: 'editor',    label: 'Editor' },
]

export default function Toc() {
  const [active, setActive] = useState<string>('providers')

  useEffect(() => {
    const targets = TOC.map((t) => document.getElementById(t.id)).filter(Boolean) as HTMLElement[]
    if (targets.length === 0) return
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: '-10% 0px -70% 0px', threshold: [0, 0.25, 0.5, 1] },
    )
    for (const t of targets) obs.observe(t)
    return () => obs.disconnect()
  }, [])

  return (
    <nav className="w-[120px] flex-shrink-0 sticky top-0 self-start py-4 pr-2 flex flex-col gap-1">
      <div className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wider px-2 mb-1">Settings</div>
      {TOC.map((t) => (
        <button
          key={t.id}
          onClick={() => document.getElementById(t.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className={`text-left text-xs px-2 py-1 rounded transition-colors ${
            active === t.id
              ? 'bg-primary/15 text-primary font-medium'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          {t.label}
        </button>
      ))}
    </nav>
  )
}
