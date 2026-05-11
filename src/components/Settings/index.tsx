import { useEffect, useState } from 'react'
import Toc from './Toc'
import ProvidersSection from './ProvidersSection'
import EditorSection from './EditorSection'
import { useProvidersStore } from '@/store/providers'

export type SettingsCategory = 'providers' | 'editor'

export default function Settings() {
  const init = useProvidersStore((s) => s.init)
  useEffect(() => {
    void init()
  }, [init])

  const [category, setCategory] = useState<SettingsCategory>('providers')

  return (
    <div className="flex w-full h-full overflow-hidden">
      <Toc active={category} onSelect={setCategory} />
      <div className="flex-1 min-w-0 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl">
          {category === 'providers' && <ProvidersSection />}
          {category === 'editor' && <EditorSection />}
        </div>
      </div>
    </div>
  )
}
