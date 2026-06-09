import type { RefObject } from 'react'
import { Pill, REF_HEIGHT } from '../ImportRefNode'
import { CM_PAD_TOP, REF_GAP } from './constants'
import type { RefLine } from './refLineLayout'

/** Pixel offset for a line, falling back to a uniform estimate before the
 *  editor has measured real line tops. */
function lineTop(line: number, linePositions: Map<number, number>): number {
  return CM_PAD_TOP + (linePositions.get(line) ?? (line - 1) * REF_HEIGHT)
}

/** `imported-by` ref pills packed into a column to the right of the editor,
 *  with labelled connectors on anchor lines. */
export function RightSideRefPills({
  overlayRef,
  rightSideLayout,
  linePositions,
  overlayHeight,
}: {
  overlayRef: RefObject<HTMLDivElement | null>
  rightSideLayout: Map<number, RefLine>
  linePositions: Map<number, number>
  overlayHeight: number
}) {
  return (
    <div
      className="absolute top-0 pointer-events-none"
      style={{
        left: `calc(100% + ${REF_GAP / 4}px)`,
        height: overlayHeight,
        width: 999,
        overflow: 'hidden',
      }}
    >
      <div ref={overlayRef}>
        {[...rightSideLayout.entries()]
          .sort(([a], [b]) => a - b)
          .map(([line, layout]) => (
            <div
              key={line}
              className="absolute flex items-center gap-0.5"
              style={{ top: lineTop(line, linePositions), height: REF_HEIGHT }}
            >
              {layout.showConnector ? (
                <div className="flex items-center shrink-0" style={{ width: REF_GAP + 12 }}>
                  <div className="h-px flex-1 bg-violet-400/20" />
                  <span className="text-[9px] text-muted-foreground/40 font-mono leading-none px-px">
                    {line}
                  </span>
                  <div className="h-px flex-1 bg-violet-400/20" />
                </div>
              ) : (
                <div className="shrink-0" style={{ width: REF_GAP + 12 }} />
              )}
              {layout.items.map((item, idx) => (
                <Pill key={`${item.kind}:${item.resolvedPath}:${idx}`} item={item} />
              ))}
            </div>
          ))}
      </div>
    </div>
  )
}
