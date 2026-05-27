import {
  createContext,
  useContext,
  useRef,
  useEffect,
  useMemo,
  useState,
  Suspense,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { PANEL_CONTENT, PANEL_IDS } from './panelContent'

interface PanelHostCtx {
  getNode: (id: string) => HTMLDivElement | null
}

const PanelHostContext = createContext<PanelHostCtx>({ getNode: () => null })

function usePanelHost() {
  return useContext(PanelHostContext)
}

function createPanelContainers(): Record<string, HTMLDivElement> {
  const containers: Record<string, HTMLDivElement> = {}
  for (const id of PANEL_IDS) {
    const el = document.createElement('div')
    el.className = 'absolute inset-0 h-full w-full'
    el.style.display = 'none'
    el.dataset.panelHost = id
    document.body.appendChild(el)
    containers[id] = el
  }
  return containers
}

export function PanelHostProvider({ children }: { children: ReactNode }) {
  const [containers] = useState(createPanelContainers)

  useEffect(() => {
    return () => {
      for (const el of Object.values(containers)) {
        el.remove()
      }
    }
  }, [containers])

  const ctx = useMemo<PanelHostCtx>(
    () => ({
      getNode: (id) => containers[id] ?? null,
    }),
    [containers],
  )

  return (
    <PanelHostContext.Provider value={ctx}>
      {children}
      {PANEL_IDS.map((id) => {
        const C = PANEL_CONTENT[id]
        return createPortal(
          <Suspense key={id} fallback={<PanelFallback />}>
            <C />
          </Suspense>,
          containers[id],
        )
      })}
    </PanelHostContext.Provider>
  )
}

function PanelFallback() {
  return (
    <div className="flex items-center justify-center h-full text-xs text-muted-foreground/60">
      Loading...
    </div>
  )
}

export function PanelSlot({ id, visible }: { id: string; visible: boolean }) {
  const { getNode } = usePanelHost()
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const wrapper = getNode(id)
    const mount = mountRef.current
    if (!wrapper || !mount) return

    mount.appendChild(wrapper)
    wrapper.style.display = 'block'

    return () => {
      wrapper.style.display = 'none'
      if (wrapper.parentNode === mount) {
        document.body.appendChild(wrapper)
      }
    }
  }, [id, getNode])

  useEffect(() => {
    const wrapper = getNode(id)
    if (wrapper && wrapper.parentNode === mountRef.current) {
      wrapper.style.display = visible ? 'block' : 'none'
    }
  }, [visible, id, getNode])

  return <div ref={mountRef} className="absolute inset-0" />
}
