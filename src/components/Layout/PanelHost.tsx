import { createContext, useContext, useRef, useEffect, useMemo, useState, Suspense, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PANEL_CONTENT, PANEL_IDS } from './panelContent';

/**
 * Renders each panel component once into a stable, long-lived DOM container.
 * `PanelSlot` reparents those containers into the active DropZone slot
 * without unmounting the React tree, so dragging a panel between zones
 * preserves its state, streaming connections, scroll position, etc.
 */
interface PanelHostCtx {
  getNode: (id: string) => HTMLDivElement | null;
}

const PanelHostContext = createContext<PanelHostCtx>({ getNode: () => null });

function usePanelHost() {
  return useContext(PanelHostContext);
}

/**
 * Stable DOM portal targets created outside the React lifecycle. `PanelSlot`
 * moves them around the DOM without affecting React's reconciliation.
 */
function createPanelContainers(): Record<string, HTMLDivElement> {
  const containers: Record<string, HTMLDivElement> = {};
  for (const id of PANEL_IDS) {
    const el = document.createElement('div');
    el.className = 'absolute inset-0 h-full w-full';
    el.style.display = 'none';
    el.dataset.panelHost = id;
    document.body.appendChild(el);
    containers[id] = el;
  }
  return containers;
}

export function PanelHostProvider({ children }: { children: ReactNode }) {
  // Lazy useState ensures createPanelContainers runs exactly once per
  // provider mount and is legal to read during render (refs are not).
  const [containers] = useState(createPanelContainers);

  useEffect(() => {
    return () => {
      for (const el of Object.values(containers)) {
        el.remove();
      }
    };
  }, [containers]);

  const ctx = useMemo<PanelHostCtx>(() => ({
    getNode: (id) => containers[id] ?? null,
  }), [containers]);

  return (
    <PanelHostContext.Provider value={ctx}>
      {children}
      {PANEL_IDS.map((id) => {
        const C = PANEL_CONTENT[id];
        return createPortal(
          <Suspense key={id} fallback={<PanelFallback />}>
            <C />
          </Suspense>,
          containers[id],
        );
      })}
    </PanelHostContext.Provider>
  );
}

function PanelFallback() {
  return (
    <div className="flex items-center justify-center h-full text-xs text-muted-foreground/60">
      Loading...
    </div>
  );
}

/**
 * Reparents a panel's stable container into its mount point. On unmount /
 * id change the container is returned to body (hidden) so it survives.
 */
export function PanelSlot({ id, visible }: { id: string; visible: boolean }) {
  const { getNode } = usePanelHost();
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrapper = getNode(id);
    const mount = mountRef.current;
    if (!wrapper || !mount) return;

    mount.appendChild(wrapper);
    wrapper.style.display = 'block';

    return () => {
      // Return to body hidden — the React portal keeps the component alive.
      wrapper.style.display = 'none';
      if (wrapper.parentNode === mount) {
        document.body.appendChild(wrapper);
      }
    };
  }, [id, getNode]);

  useEffect(() => {
    const wrapper = getNode(id);
    if (wrapper && wrapper.parentNode === mountRef.current) {
      wrapper.style.display = visible ? 'block' : 'none';
    }
  }, [visible, id, getNode]);

  return <div ref={mountRef} className="absolute inset-0" />;
}
