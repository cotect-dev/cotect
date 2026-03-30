import { type ComponentType } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { X } from 'lucide-react';
import { getPanelLabel, useLayoutStore, type PanelPosition } from '@/store/layout';
import Chat from '@/components/Chat';
import Console from '@/components/Console';
import Terminal from '@/components/Terminal';

const PANEL_CONTENT: Record<string, ComponentType> = {
  chat: Chat,
  console: Console,
  terminal: Terminal,
};

interface PanelAreaProps {
  group: string[];
  position: PanelPosition;
  groupIndex: number;
  ghostTabLabel?: string | null;
}

function TabButton({ id, isActive, position, onClick }: { id: string; isActive: boolean; position: PanelPosition; onClick: () => void }) {
  const label = getPanelLabel(id);
  const removePanel = useLayoutStore((s) => s.removePanel);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `tab-${id}`,
    data: { panelId: id, position, isTab: true },
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-0.5 shrink-0 select-none transition-colors border-b-2 ${
        isActive
          ? 'border-primary/60 text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground/80'
      } ${isDragging ? 'opacity-20' : ''}`}
    >
      <button
        {...listeners}
        {...attributes}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="px-2.5 py-1.5 text-xs truncate cursor-grab active:cursor-grabbing max-w-[120px]"
      >
        {label}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          removePanel(id);
        }}
        className="p-0.5 mr-1 rounded-sm hover:bg-destructive/20 hover:text-destructive transition-colors"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function GhostTab({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-0.5 shrink-0 select-none border-b-2 border-primary/40">
      <span className="px-2.5 py-1.5 text-xs text-primary/40 truncate max-w-[120px]">
        {label}
      </span>
    </div>
  );
}

export default function PanelArea({ group, position, groupIndex, ghostTabLabel }: PanelAreaProps) {
  const activeTabIndex = useLayoutStore((s) => s.activeTab[group[0]] ?? 0);
  const setActiveTab = useLayoutStore((s) => s.setActiveTab);
  const activeIndex = Math.min(activeTabIndex, group.length - 1);
  const activeId = group[activeIndex];
  const Content = PANEL_CONTENT[activeId];

  // Draggable for the entire group (drag from empty header space)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `group-${group[0]}`,
    data: { panelId: group[0], panelIds: group, position, isGroup: true, groupIndex },
  });

  const isSingle = group.length === 1 && !ghostTabLabel;
  const removePanel = useLayoutStore((s) => s.removePanel);

  return (
    <div
      data-panel-area={group[0]}
      className={`h-full w-full overflow-hidden bg-background/80 backdrop-blur-sm flex flex-col transition-opacity duration-200 ${
        isDragging ? 'opacity-20' : ''
      }`}
    >
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        className="flex items-center border-b border-border/50 shrink-0 cursor-grab active:cursor-grabbing hover:bg-muted/50 transition-colors select-none overflow-x-auto"
      >
        {isSingle ? (
          <>
            <span className="flex-1 px-3 py-1.5 text-xs text-muted-foreground truncate">
              {getPanelLabel(group[0])}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                removePanel(group[0]);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="px-2 py-1.5 text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <div className="flex items-center flex-1 min-w-0">
            {group.map((id, i) => (
              <TabButton
                key={id}
                id={id}
                isActive={i === activeIndex}
                position={position}
                onClick={() => setActiveTab(group[0], i)}
              />
            ))}
            {ghostTabLabel && <GhostTab label={ghostTabLabel} />}
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 relative">
        {group.map((id, i) => {
          const C = PANEL_CONTENT[id];
          if (!C) return null;
          return (
            <div
              key={id}
              className="absolute inset-0"
              style={{ display: i === activeIndex ? 'block' : 'none' }}
            >
              <C />
            </div>
          );
        })}
      </div>
    </div>
  );
}
