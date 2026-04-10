import { createContext, useContext, useRef, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Chat from '@/components/Chat';
import Console from '@/components/Console';
import Changes from '@/components/Changes';
import History from '@/components/History';
import Branches from '@/components/Branches';
import Tasks from '@/components/Tasks';
import Settings from '@/components/Settings';

export const PANEL_CONTENT: Record<string, ComponentType> = {
  chat: Chat,
  console: Console,
  changes: Changes,
  history: History,
  branches: Branches,
  tasks: Tasks,
  settings: Settings,
};

const PANEL_IDS = Object.keys(PANEL_CONTENT);

/**
 * PanelHost renders every known panel component exactly once into stable,
 * long-lived DOM containers.  `PanelSlot` can then reparent those containers
 * into whatever DropZone slot is currently active — without unmounting the
 * React tree.
 *
 * This lets the Chat (or any other panel) survive being dragged between zones
 * while keeping its full component state, streaming connections, scroll
 * positions, etc.
 */
interface PanelHostCtx {
  /** Stable DOM container elements keyed by panel id. */
  getNode: (id: string) => HTMLDivElement | null;
}

const PanelHostContext = createContext<PanelHostCtx>({ getNode: () => null });

function usePanelHost() {
  return useContext(PanelHostContext);
}

/**
 * Creates stable DOM elements (once, outside the React lifecycle) that serve
 * as portal targets.  React renders panel components *into* these elements via
 * `createPortal`.  The elements themselves can be freely moved around the DOM
 * by `PanelSlot` without affecting React's reconciliation.
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
  // useState with a lazy initializer guarantees createPanelContainers runs
  // exactly once per provider mount — equivalent to a ref, but legal to read
  // during render (refs are not).
  const [containers] = useState(createPanelContainers);

  // Clean up DOM elements when provider unmounts
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
        return createPortal(<C key={id} />, containers[id]);
      })}
    </PanelHostContext.Provider>
  );
}

/**
 * PanelSlot adopts (reparents) a panel's stable DOM container into its own
 * mount point.  When the slot unmounts or changes panel id, the container is
 * returned to `document.body` (hidden) so it isn't destroyed.
 */
export function PanelSlot({ id, visible }: { id: string; visible: boolean }) {
  const { getNode } = usePanelHost();
  const mountRef = useRef<HTMLDivElement>(null);

  // Adopt/release the panel's stable DOM container
  useEffect(() => {
    const wrapper = getNode(id);
    const mount = mountRef.current;
    if (!wrapper || !mount) return;

    mount.appendChild(wrapper);
    wrapper.style.display = 'block';

    return () => {
      // Return to body (hidden) — the React portal keeps the component alive
      wrapper.style.display = 'none';
      if (wrapper.parentNode === mount) {
        document.body.appendChild(wrapper);
      }
    };
  }, [id, getNode]);

  // Toggle visibility without re-adopting
  useEffect(() => {
    const wrapper = getNode(id);
    if (wrapper && wrapper.parentNode === mountRef.current) {
      wrapper.style.display = visible ? 'block' : 'none';
    }
  }, [visible, id, getNode]);

  return <div ref={mountRef} className="absolute inset-0" />;
}
