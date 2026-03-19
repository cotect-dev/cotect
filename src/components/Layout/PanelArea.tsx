import { useDraggable } from '@dnd-kit/core';
import { GripHorizontal } from 'lucide-react';
import type { PanelPosition } from '@/store/layout';

interface PanelAreaProps {
  id: string;
  position: PanelPosition;
}

export default function PanelArea({ id, position }: PanelAreaProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { panelId: id, position },
  });

  return (
    <div
      ref={setNodeRef}
      className={`h-full w-full overflow-hidden bg-background/80 backdrop-blur-sm flex flex-col transition-opacity duration-200 ${
        isDragging ? 'opacity-20' : ''
      }`}
    >
      <div
        {...listeners}
        {...attributes}
        className="flex items-center border-b border-border/50 shrink-0 cursor-grab active:cursor-grabbing hover:bg-muted/50 transition-colors select-none"
      >
        <span className="flex-1 px-3 py-1.5 text-xs text-muted-foreground truncate">
          {id}
        </span>
        <div className="px-2 py-1.5 text-muted-foreground">
          <GripHorizontal className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="flex-1" />
    </div>
  );
}
