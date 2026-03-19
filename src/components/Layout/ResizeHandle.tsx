import { useCallback, useRef } from 'react';

interface BaseProps {
  orientation: 'horizontal' | 'vertical';
}

interface TargetModeProps extends BaseProps {
  mode: 'target';
  targetRef: React.RefObject<HTMLDivElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** -1 = shrink target when pointer moves positive, 1 = grow target */
  direction?: 1 | -1;
  min: number;
  max: number;
  onResizeEnd: (ratio: number) => void;
}

interface SiblingModeProps extends BaseProps {
  mode: 'sibling';
  onResizeEnd: (
    pixelLeft: number,
    pixelRight: number,
    totalPixelWidth: number,
  ) => void;
}

type ResizeHandleProps = TargetModeProps | SiblingModeProps;

export default function ResizeHandle(props: ResizeHandleProps) {
  const { orientation } = props;
  const handleRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const handle = handleRef.current;
      if (!handle) return;

      const isVert = orientation === 'vertical';

      const startPos = isVert ? e.clientX : e.clientY;

      let handleMouseMove: (e: MouseEvent) => void;
      let handleMouseUp: () => void;

      if (props.mode === 'target') {
        const { targetRef, containerRef, direction = 1, min, max, onResizeEnd } = props;
        const target = targetRef.current;
        const container = containerRef.current;
        if (!target || !container) return;

        const startSize = isVert ? target.offsetWidth : target.offsetHeight;
        const containerSize = isVert ? container.clientWidth : container.clientHeight;

        target.style.transition = 'none';
        handle.setAttribute('data-resizing', '');

        handleMouseMove = (e: MouseEvent) => {
          const current = isVert ? e.clientX : e.clientY;
          const delta = (current - startPos) * direction;
          const newSize = Math.max(
            min,
            Math.min(startSize + delta, containerSize * max),
          );
          target.style.flexBasis = `${newSize}px`;
        };

        handleMouseUp = () => {
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          handle.removeAttribute('data-resizing');

          const finalSize = isVert ? target.offsetWidth : target.offsetHeight;
          onResizeEnd(finalSize / containerSize);

          // React re-render will overwrite flexBasis with the new percentage.
          // Just restore transition.
          target.style.transition = '';
        };
      } else {
        const { onResizeEnd } = props;
        const parent = handle.parentElement;
        const prevEl = handle.previousElementSibling as HTMLElement | null;
        const nextEl = handle.nextElementSibling as HTMLElement | null;
        if (!parent || !prevEl || !nextEl) return;

        const allChildren = Array.from(parent.children) as HTMLElement[];
        const childSizes = allChildren.map(child =>
          isVert ? child.offsetWidth : child.offsetHeight,
        );
        const prevIdx = allChildren.indexOf(prevEl);
        const nextIdx = allChildren.indexOf(nextEl);
        const prevStart = childSizes[prevIdx];
        const nextStart = childSizes[nextIdx];
        const totalSize = prevStart + nextStart;

        for (let i = 0; i < allChildren.length; i++) {
          allChildren[i].style.transition = 'none';
          allChildren[i].style.flexGrow = '0';
          allChildren[i].style.flexShrink = '0';
          allChildren[i].style.flexBasis = `${childSizes[i]}px`;
        }
        handle.setAttribute('data-resizing', '');

        handleMouseMove = (e: MouseEvent) => {
          const current = isVert ? e.clientX : e.clientY;
          const delta = current - startPos;
          const newPrev = Math.max(
            40,
            Math.min(prevStart + delta, totalSize - 40),
          );
          const newNext = totalSize - newPrev;
          prevEl.style.flexBasis = `${newPrev}px`;
          nextEl.style.flexBasis = `${newNext}px`;
        };

        handleMouseUp = () => {
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          handle.removeAttribute('data-resizing');

          const finalPrev = isVert ? prevEl.offsetWidth : prevEl.offsetHeight;
          const finalNext = isVert ? nextEl.offsetWidth : nextEl.offsetHeight;
          onResizeEnd(finalPrev, finalNext, totalSize);

          for (const child of allChildren) {
            child.style.transition = '';
          }
        };
      }

      document.body.style.cursor = isVert ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props],
  );

  const isVertical = orientation === 'vertical';

  return (
    <div
      ref={handleRef}
      onMouseDown={handleMouseDown}
      className={`group/handle relative flex items-center justify-center pointer-events-auto shrink-0
        ${
          isVertical
            ? 'w-px cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2'
            : 'h-px cursor-row-resize after:absolute after:inset-x-0 after:top-1/2 after:h-3 after:-translate-y-1/2'
        } bg-foreground/10 hover:bg-primary/40 data-[resizing]:bg-primary/40 transition-colors`}
    >
      <div
        className={`z-10 shrink-0 rounded-lg transition-colors
          bg-background border border-foreground/15 group-hover/handle:border-primary/40 group-data-[resizing]/handle:border-primary/40
          ${isVertical ? 'h-6 w-1.5' : 'w-6 h-1.5'}`}
      />
    </div>
  );
}
