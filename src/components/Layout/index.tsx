import { useRef } from 'react'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { GripHorizontal } from 'lucide-react'
import TopBar from './TopBar'
import DropZone from './DropZone'
import EdgeDropTarget from './EdgeDropTarget'
import ResizeHandle from './ResizeHandle'
import { usePanelDrag } from './usePanelDrag'
import { DEFAULT_ZONE_SIZES, getPanelLabel, useLayoutStore } from '@/store/layout'
import CrossWindowDropOverlay from './CrossWindowDropOverlay'
import { PanelHostProvider } from './PanelHost'
import { MIN_SIDE_ZONE, MIN_BOTTOM_ZONE } from '@/lib/constants'

interface LayoutProps {
  mode?: 'main' | 'panel'
}

export default function Layout({ mode = 'main' }: LayoutProps) {
  const {
    panels,
    dragState,
    isDragging,
    zoneRefs,
    sensors,
    collisionDetection,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
    centerOnCursor,
    effectiveCount,
    isZoneEmpty,
  } = usePanelDrag()

  const zoneSizes = useLayoutStore((s) => s.zoneSizes)
  const setZoneSizes = useLayoutStore((s) => s.setZoneSizes)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const topRowRef = useRef<HTMLDivElement | null>(null)
  const leftZoneRef = useRef<HTMLDivElement | null>(null)
  const rightZoneRef = useRef<HTMLDivElement | null>(null)
  const bottomZoneRef = useRef<HTMLDivElement | null>(null)

  const commitSize = (key: 'left' | 'right' | 'bottom') => (ratio: number) =>
    setZoneSizes({ [key]: ratio })

  const crossWindowDrag = useLayoutStore((s) => s.crossWindowDrag)

  const activeDrag = dragState ?? (crossWindowDrag ? {
    panelId: crossWindowDrag.panelIds[0],
    panelIds: crossWindowDrag.panelIds,
    isGroup: crossWindowDrag.panelIds.length > 1,
    overPosition: crossWindowDrag.position,
    insertIndex: crossWindowDrag.insertIndex,
    neighborIndex: crossWindowDrag.neighborIndex,
    tabIntoGroupKey: null,
  } : null)

  const anyDragging = isDragging || !!crossWindowDrag

  const isPanel = mode === 'panel'

  const leftVisible = isPanel || (crossWindowDrag?.position === 'left' ? 1 : 0) + effectiveCount('left') > 0
  const rightVisible = isPanel || (crossWindowDrag?.position === 'right' ? 1 : 0) + effectiveCount('right') > 0
  const bottomVisible = !isPanel && ((crossWindowDrag?.position === 'bottom' ? 1 : 0) + effectiveCount('bottom') > 0)

  const previewFor = (pos: 'left' | 'right' | 'bottom') =>
    activeDrag?.overPosition === pos && !activeDrag.tabIntoGroupKey
      ? { previewIndex: activeDrag.insertIndex, neighborIndex: activeDrag.neighborIndex }
      : { previewIndex: null, neighborIndex: null }

  const tabIntoFor = (pos: 'left' | 'right' | 'bottom') =>
    activeDrag?.overPosition === pos ? activeDrag.tabIntoGroupKey : null

  const overlayLabel = activeDrag
    ? activeDrag.isGroup && activeDrag.panelIds
      ? activeDrag.panelIds.map(getPanelLabel).join(' / ')
      : getPanelLabel(activeDrag.panelId)
    : ''

  const resetZoneSizes = () => setZoneSizes({ ...DEFAULT_ZONE_SIZES })

  return (
    <PanelHostProvider>
    <div className="w-screen h-screen flex flex-col">
      <div className="pointer-events-none" data-zone="top">
        <TopBar onResetZoneSizes={resetZoneSizes} />
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div ref={containerRef} className="relative flex-1 min-h-0 w-full flex flex-col pointer-events-none">
          {isZoneEmpty('left') && <EdgeDropTarget position="left" panelMode={isPanel} />}
          {isZoneEmpty('right') && <EdgeDropTarget position="right" panelMode={isPanel} />}
          {!isPanel && isZoneEmpty('bottom') && <EdgeDropTarget position="bottom" />}

          <div ref={topRowRef} className="flex-1 min-h-0 flex flex-row">
            <div
              ref={(el) => { zoneRefs.current.left = el; leftZoneRef.current = el }}
              className="h-full pointer-events-auto"
              data-zone="left"
              style={isPanel ? {
                flexGrow: 1,
                flexShrink: 1,
                flexBasis: 0,
                minWidth: '25%',
                maxWidth: '75%',
              } : {
                flexGrow: 0,
                flexShrink: 0,
                flexBasis: leftVisible ? `${zoneSizes.left * 100}%` : '0px',
                minWidth: leftVisible ? MIN_SIDE_ZONE : 0,
                maxWidth: '40%',
              }}
            >
              <DropZone
                position="left"
                groups={panels.left}
                activePanelId={activeDrag?.panelId ?? null}
                activePanelIds={activeDrag?.panelIds}
                isGroupDrag={activeDrag?.isGroup ?? false}
                {...previewFor('left')}
                tabIntoGroupKey={tabIntoFor('left')}
              />
            </div>

            {isPanel ? (
              !anyDragging && (
                <ResizeHandle mode="sibling" orientation="vertical" onResizeEnd={(pixelLeft, pixelRight) => {
                  const total = pixelLeft + pixelRight
                  if (total > 0) {
                    setZoneSizes({ left: pixelLeft / total, right: pixelRight / total })
                  }
                }} />
              )
            ) : (
              <>
                {leftVisible && !anyDragging && (
                  <ResizeHandle mode="target" orientation="vertical" targetRef={leftZoneRef} containerRef={topRowRef} min={MIN_SIDE_ZONE} max={0.4} onResizeEnd={commitSize('left')} />
                )}

                <div className="flex-1 min-w-[20%]" />

                {rightVisible && !anyDragging && (
                  <ResizeHandle mode="target" orientation="vertical" targetRef={rightZoneRef} containerRef={topRowRef} direction={-1} min={MIN_SIDE_ZONE} max={0.4} onResizeEnd={commitSize('right')} />
                )}
              </>
            )}

            <div
              ref={(el) => { zoneRefs.current.right = el; rightZoneRef.current = el }}
              className="h-full pointer-events-auto"
              data-zone="right"
              style={isPanel ? {
                flexGrow: 1,
                flexShrink: 1,
                flexBasis: 0,
                minWidth: '25%',
                maxWidth: '75%',
              } : {
                flexGrow: 0,
                flexShrink: 0,
                flexBasis: rightVisible ? `${zoneSizes.right * 100}%` : '0px',
                minWidth: rightVisible ? MIN_SIDE_ZONE : 0,
                maxWidth: '40%',
              }}
            >
              <DropZone
                position="right"
                groups={panels.right}
                activePanelId={activeDrag?.panelId ?? null}
                activePanelIds={activeDrag?.panelIds}
                isGroupDrag={activeDrag?.isGroup ?? false}
                {...previewFor('right')}
                tabIntoGroupKey={tabIntoFor('right')}
              />
            </div>
          </div>

          {!isPanel && bottomVisible && !anyDragging && (
            <ResizeHandle mode="target" orientation="horizontal" targetRef={bottomZoneRef} containerRef={containerRef} direction={-1} min={MIN_BOTTOM_ZONE} max={0.5} onResizeEnd={commitSize('bottom')} />
          )}

          {!isPanel && (
            <div
              ref={(el) => { zoneRefs.current.bottom = el; bottomZoneRef.current = el }}
              className="w-full pointer-events-auto relative z-[1]"
              data-zone="bottom"
              style={{
                flexGrow: 0,
                flexShrink: 0,
                flexBasis: bottomVisible ? `${zoneSizes.bottom * 100}%` : '0px',
                minHeight: bottomVisible ? MIN_BOTTOM_ZONE : 0,
                maxHeight: '50%',
              }}
            >
              <DropZone
                position="bottom"
                groups={panels.bottom}
                activePanelId={activeDrag?.panelId ?? null}
                activePanelIds={activeDrag?.panelIds}
                isGroupDrag={activeDrag?.isGroup ?? false}
                {...previewFor('bottom')}
                tabIntoGroupKey={tabIntoFor('bottom')}
              />
            </div>
          )}
        </div>

        <DragOverlay dropAnimation={null} modifiers={[centerOnCursor]}>
          {dragState ? (
            <div className="pointer-events-none w-[150px] bg-background/90 backdrop-blur-md rounded shadow-lg border border-primary/30 flex items-center">
              <span className="flex-1 px-3 py-1.5 text-xs text-muted-foreground truncate">
                {overlayLabel}
              </span>
              <div className="px-2 py-1.5 text-muted-foreground">
                <GripHorizontal className="h-3.5 w-3.5" />
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <CrossWindowDropOverlay zoneRefs={zoneRefs} mode={mode} />
    </div>
    </PanelHostProvider>
  )
}
