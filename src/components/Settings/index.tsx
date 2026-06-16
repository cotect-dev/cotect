import { useState } from 'react'
import GeneralSection from './GeneralSection'
import EditorSection from './EditorSection'
import WhatsNewSection from './WhatsNewSection'

type SectionId = 'general' | 'whatsnew' | 'editor'

const NAV: { id: SectionId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'whatsnew', label: "What's new" },
  { id: 'editor', label: 'Editor' },
]

export default function Settings() {
  const [active, setActive] = useState<SectionId>('general')

  return (
    <div className="flex w-full h-full overflow-hidden">
      <nav className="w-44 shrink-0 border-r border-border overflow-y-auto py-4 px-2">
        {NAV.map((item) => (
          <button
            key={item.id}
            onClick={() => setActive(item.id)}
            className={`w-full text-left text-xs rounded px-2 py-1.5 transition-colors ${
              active === item.id
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 min-w-0 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl">
          {active === 'general' && <GeneralSection />}
          {active === 'whatsnew' && <WhatsNewSection />}
          {active === 'editor' && <EditorSection />}
        </div>
      </div>
    </div>
  )
}
