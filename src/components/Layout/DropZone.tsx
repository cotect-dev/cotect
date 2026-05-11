import { useMemo, useCallback } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { useLayoutStore, getPanelLabel, type PanelPosition } from '@/store/layout'
import PanelArea from './PanelArea'
import ResizeHandle from './ResizeHandle'

interface DropZoneProps {
  position: PanelPosition
  groups: string[][]
  activePanelId: string | null
  activePanelIds?: string[]
  isGroupDrag: boolean
  previewIndex: number | null
  neighborIndex: number | null
  tabIntoGroupKey: string | null
}

export default function DropZone({
  position,
  groups,
  activePanelId,
  activePanelIds,
  isGroupDrag,
  previewIndex,
  neighborIndex,
  tabIntoGroupKey,
}: DropZoneProps) {
  const { setNodeRef } = useDroppable({
    id: `drop-${position}`,
    data: { position },
    disabled: groups.length === 0,
  })

  const sizes = useLayoutStore((s) => s.sizes[position])

  const isVertical = position === 'left' || position === 'right'

  const { visibleGroups, visibleSizes } = useMemo(() => {
    const vGroups: string[][] = []
    const vSizes: number[] = []
    for (let i = 0; i < groups.length; i++) {
      if (isGroupDrag && activePanelId && groups[i][0] === activePanelId) {
        continue
      }
      if (!isGroupDrag && activePanelId && groups[i].includes(activePanelId)) {
        const remaining = groups[i].filter((id) => id !== activePanelId)
        if (remaining.length > 0) {
          vGroups.push(remaining)
          vSizes.push(sizes[i] ?? 1)
        }
        continue
      }
      vGroups.push(groups[i])
      vSizes.push(sizes[i] ?? 1)
    }
    return { visibleGroups: vGroups, visibleSizes: vSizes }
  }, [groups, sizes, activePanelId, isGroupDrag])

  const showGhost =
    previewIndex !== null && neighborIndex !== null && !!activePanelId && !tabIntoGroupKey

  const originalIndex = activePanelId
    ? groups.findIndex((g) => (isGroupDrag ? g[0] === activePanelId : g.includes(activePanelId)))
    : -1
  const isSourceZone = originalIndex >= 0
  const isNoOp = showGhost && isSourceZone && previewIndex === originalIndex

  const items: { type: 'group' | 'ghost'; group: string[]; size: number }[] = []

  if (showGhost) {
    let rawSizes: number[]
    let rawGhost: number

    if (visibleGroups.length === 0) {
      rawGhost = 1
      rawSizes = []
    } else if (isNoOp) {
      rawGhost = sizes[originalIndex] ?? 1
      rawSizes = [...visibleSizes]
    } else {
      rawSizes = [...visibleSizes]
      const nSize = rawSizes[neighborIndex]
      rawGhost = nSize / 2
      rawSizes[neighborIndex] = nSize / 2
    }

    let groupIdx = 0
    const totalSlots = visibleGroups.length + 1
    for (let i = 0; i < totalSlots; i++) {
      if (i === previewIndex) {
        items.push({
          type: 'ghost',
          group: isGroupDrag
            ? (groups.find((g) => g[0] === activePanelId) ?? [activePanelId!])
            : [activePanelId!],
          size: rawGhost,
        })
      } else {
        if (groupIdx < visibleGroups.length) {
          items.push({ type: 'group', group: visibleGroups[groupIdx], size: rawSizes[groupIdx] })
          groupIdx++
        }
      }
    }
  } else {
    for (let i = 0; i < visibleGroups.length; i++) {
      items.push({ type: 'group', group: visibleGroups[i], size: visibleSizes[i] })
    }
  }

  const rawTotal = items.reduce((a, b) => a + b.size, 0)
  if (rawTotal > 0 && rawTotal !== 1) {
    for (const item of items) {
      item.size /= rawTotal
    }
  }

  const isDragging = !!activePanelId

  const makeResizeHandler = useCallback(
    (leftKey: string, rightKey: string) => {
      return (pixelLeft: number, pixelRight: number, totalPixelWidth: number) => {
        useLayoutStore.setState((state) => {
          const currentGroups = state.panels[position]
          const leftIdx = currentGroups.findIndex((g) => g[0] === leftKey)
          const rightIdx = currentGroups.findIndex((g) => g[0] === rightKey)
          if (leftIdx < 0 || rightIdx < 0) return state

          const newSizes = [...state.sizes[position]]
          const leftNormalized = newSizes[leftIdx]
          const rightNormalized = newSizes[rightIdx]
          const pairTotal = leftNormalized + rightNormalized

          const leftRatio = pixelLeft / totalPixelWidth
          const rightRatio = pixelRight / totalPixelWidth

          newSizes[leftIdx] = pairTotal * leftRatio
          newSizes[rightIdx] = pairTotal * rightRatio
          return { sizes: { ...state.sizes, [position]: newSizes } }
        })
      }
    },
    [position],
  )

  return (
    <div ref={setNodeRef} className={`h-full w-full flex ${isVertical ? 'flex-col' : 'flex-row'}`}>
      {items.map((item, i) => {
        const grow = item.size
        const elements: React.ReactNode[] = []
        const itemKey = item.group[0]

        if (i > 0 && !isDragging && item.type === 'group' && items[i - 1].type === 'group') {
          elements.push(
            <ResizeHandle
              key={`resize-${items[i - 1].group[0]}-${itemKey}`}
              mode="sibling"
              orientation={isVertical ? 'horizontal' : 'vertical'}
              onResizeEnd={(pixelLeft, pixelRight, totalPixelWidth) =>
                makeResizeHandler(items[i - 1].group[0], itemKey)(
                  pixelLeft,
                  pixelRight,
                  totalPixelWidth,
                )
              }
            />,
          )
        }

        if (item.type === 'group') {
          const isTabTarget = tabIntoGroupKey === itemKey
          const ghostLabel =
            isTabTarget && activePanelId
              ? isGroupDrag && activePanelIds
                ? activePanelIds.map(getPanelLabel).join(' / ')
                : getPanelLabel(activePanelId)
              : null
          elements.push(
            <div
              key={itemKey}
              className="min-h-0 min-w-0"
              style={{ flexGrow: grow, flexShrink: 1, flexBasis: 0 }}
            >
              <PanelArea
                group={item.group}
                position={position}
                groupIndex={i}
                ghostTabLabel={ghostLabel}
              />
            </div>,
          )
        } else {
          elements.push(
            <div
              key="__ghost__"
              className="min-h-0 min-w-0"
              style={{ flexGrow: grow, flexShrink: 1, flexBasis: 0 }}
            >
              <div className="h-full w-full bg-primary/10 border-2 border-dashed border-primary/30 rounded-sm flex flex-col">
                <div className="flex items-center border-b border-primary/20 shrink-0">
                  {item.group.map((id) => (
                    <span key={id} className="px-2.5 py-1.5 text-xs text-primary/40 truncate">
                      {getPanelLabel(id)}
                    </span>
                  ))}
                </div>
                <div className="flex-1" />
              </div>
            </div>,
          )
        }

        return elements
      })}
    </div>
  )
}
