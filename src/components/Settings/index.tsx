import { useEffect } from 'react'
import Toc from './Toc'
import ProvidersSection from './ProvidersSection'
import AgentSection from './AgentSection'
import EditorSection from './EditorSection'
import { useProvidersStore } from '@/store/providers'

export default function Settings() {
  const init = useProvidersStore((s) => s.init)
  useEffect(() => { void init() }, [init])

  return (
    <div className="flex w-full h-full overflow-hidden">
      <Toc />
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 flex flex-col gap-12">
          <section id="providers" className="scroll-mt-4">
            <ProvidersSection />
          </section>
          <section id="agent" className="scroll-mt-4">
            <AgentSection />
          </section>
          <section id="editor" className="scroll-mt-4">
            <EditorSection />
          </section>
        </div>
      </div>
    </div>
  )
}
