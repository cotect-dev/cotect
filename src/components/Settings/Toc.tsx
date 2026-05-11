import type { SettingsCategory } from './index'

interface TocItem {
  id: SettingsCategory
  label: string
}

const TOC: TocItem[] = [
  { id: 'providers', label: 'Providers' },
  { id: 'editor', label: 'Editor' },
]

interface TocProps {
  active: SettingsCategory
  onSelect: (id: SettingsCategory) => void
}

export default function Toc({ active, onSelect }: TocProps) {
  return (
    <nav className="w-[120px] flex-shrink-0 py-4 pr-2 flex flex-col gap-1">
      <div className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wider px-2 mb-1">
        Settings
      </div>
      {TOC.map((t) => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
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
