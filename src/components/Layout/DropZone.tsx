import { useDroppable } from '@dnd-kit/core';
import { GripHorizontal } from 'lucide-react';
import { useLayoutStore, getPanelLabel, type PanelPosition } from '@/store/layout';
import PanelArea from './PanelArea';
import ResizeHandle from './ResizeHandle';

interface DropZoneProps {
  position: PanelPosition;
  panelIds: string[];
  activePanelId: string | null;
  previewIndex: number | null;
  neighborIndex: number | null;
}

export default function DropZone({
  position,
  panelIds,
  activePanelId,
  previewIndex,
  neighborIndex,
}: DropZoneProps) {
  const { setNodeRef } = useDroppable({
    id: `drop-${position}`,
    data: { position },
    disabled: panelIds.length === 0,
  });

  const sizes = useLayoutStore(s => s.sizes[position]);

  const isVertical = position === 'left' || position === 'right';

  const visiblePanels: string[] = [];
  const visibleSizes: number[] = [];
  for (let i = 0; i < panelIds.length; i++) {
    if (panelIds[i] !== activePanelId) {
      visiblePanels.push(panelIds[i]);
      visibleSizes.push(sizes[i] ?? 1);
    }
  }

  const showGhost = previewIndex !== null && neighborIndex !== null && !!activePanelId;

  // Detect no-op: dragging back to the same position in the source zone.
  // movePanel returns state unchanged in this case, so the preview must match.
  const originalIndex = activePanelId ? panelIds.indexOf(activePanelId) : -1;
  const isSourceZone = originalIndex >= 0;
  const isNoOp = showGhost && isSourceZone && previewIndex === originalIndex;

  // Build item list with sizes that always sum to 1 so content fills the zone.
  // Ghost sizing mirrors movePanel: no-op → original size, real move → split neighbor.
  const items: { type: 'panel' | 'ghost'; id: string; size: number }[] = [];

  if (showGhost) {
    let rawSizes: number[];
    let rawGhost: number;

    if (visiblePanels.length === 0) {
      rawGhost = 1;
      rawSizes = [];
    } else if (isNoOp) {
      rawGhost = sizes[originalIndex] ?? 1;
      rawSizes = [...visibleSizes];
    } else {
      rawSizes = [...visibleSizes];
      const nSize = rawSizes[neighborIndex];
      rawGhost = nSize / 2;
      rawSizes[neighborIndex] = nSize / 2;
    }

    // Build items in order, inserting ghost at previewIndex
    let panelIdx = 0;
    const totalSlots = visiblePanels.length + 1;
    for (let i = 0; i < totalSlots; i++) {
      if (i === previewIndex) {
        items.push({ type: 'ghost', id: '__ghost__', size: rawGhost });
      } else {
        if (panelIdx < visiblePanels.length) {
          items.push({ type: 'panel', id: visiblePanels[panelIdx], size: rawSizes[panelIdx] });
          panelIdx++;
        }
      }
    }
  } else {
    for (let i = 0; i < visiblePanels.length; i++) {
      items.push({ type: 'panel', id: visiblePanels[i], size: visibleSizes[i] });
    }
  }

  // Normalize so sizes always sum to 1 — content always fills the zone
  const rawTotal = items.reduce((a, b) => a + b.size, 0);
  if (rawTotal > 0 && rawTotal !== 1) {
    for (const item of items) {
      item.size /= rawTotal;
    }
  }
  const isDragging = !!activePanelId;

  const makeResizeHandler = (leftId: string, rightId: string) => {
    return (pixelLeft: number, pixelRight: number, totalPixelWidth: number) => {
      useLayoutStore.setState(state => {
        const currentPanels = state.panels[position].filter(
          id => id !== activePanelId,
        );
        const leftIdx = currentPanels.indexOf(leftId);
        const rightIdx = currentPanels.indexOf(rightId);
        if (leftIdx < 0 || rightIdx < 0) return state;

        const newSizes = [...state.sizes[position]];
        const leftNormalized = newSizes[leftIdx];
        const rightNormalized = newSizes[rightIdx];
        const pairTotal = leftNormalized + rightNormalized;

        const leftRatio = pixelLeft / totalPixelWidth;
        const rightRatio = pixelRight / totalPixelWidth;

        newSizes[leftIdx] = pairTotal * leftRatio;
        newSizes[rightIdx] = pairTotal * rightRatio;
        return { sizes: { ...state.sizes, [position]: newSizes } };
      });
    };
  };

  return (
    <div
      ref={setNodeRef}
      className={`h-full w-full flex ${isVertical ? 'flex-col' : 'flex-row'}`}
    >
      {items.map((item, i) => {
        const grow = item.size;
        const elements: React.ReactNode[] = [];

        if (
          i > 0 &&
          !isDragging &&
          item.type === 'panel' &&
          items[i - 1].type === 'panel'
        ) {
          elements.push(
            <ResizeHandle
              key={`resize-${items[i - 1].id}-${item.id}`}
              mode="sibling"
              orientation={isVertical ? 'horizontal' : 'vertical'}
              onResizeEnd={(pixelLeft, pixelRight, totalPixelWidth) =>
                makeResizeHandler(items[i - 1].id, item.id)(
                  pixelLeft,
                  pixelRight,
                  totalPixelWidth,
                )
              }
            />,
          );
        }

        if (item.type === 'panel') {
          elements.push(
            <div
              key={item.id}
              className="min-h-0 min-w-0"
              style={{ flexGrow: grow, flexShrink: 1, flexBasis: 0 }}
            >
              <PanelArea id={item.id} position={position} />
            </div>,
          );
        } else {
          elements.push(
            <div
              key="__ghost__"
              className="min-h-0 min-w-0"
              style={{ flexGrow: grow, flexShrink: 1, flexBasis: 0 }}
            >
              <div className="h-full w-full bg-primary/10 border-2 border-dashed border-primary/30 rounded-sm flex flex-col">
                <div className="flex items-center border-b border-primary/20 shrink-0">
                  <span className="flex-1 px-3 py-1.5 text-xs text-primary/40 truncate">
                    {getPanelLabel(activePanelId!)}
                  </span>
                  <div className="px-2 py-1.5 text-primary/40">
                    <GripHorizontal className="h-3.5 w-3.5" />
                  </div>
                </div>
                <div className="flex-1" />
              </div>
            </div>,
          );
        }

        return elements;
      })}
    </div>
  );
}
