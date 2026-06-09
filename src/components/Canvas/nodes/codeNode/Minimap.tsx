export interface MinimapStripe {
  startFrac: number
  endFrac: number
  color: string
  /** Document position of the change start — used to scroll there and as the
   *  stable identity for the pinned stripe (array indices shift when the diff
   *  is recomputed). */
  fromPos: number
}

interface MinimapProps {
  stripes: MinimapStripe[]
  editorHeight: number
  pinnedPos: number | null
  onStripeClick: (fromPos: number) => void
}

/** Right-edge change minimap: one stripe per diff chunk, click to scroll the
 *  editor to that change and pin it. */
export function Minimap({ stripes, editorHeight, pinnedPos, onStripeClick }: MinimapProps) {
  return (
    <div className="relative shrink-0 pointer-events-auto z-10" style={{ width: 22 }}>
      <div
        className="relative h-full"
        style={{
          background: 'rgba(0,0,0,0.25)',
          borderLeft: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {stripes.map((stripe, i) => {
          const minH = 4
          const top = stripe.startFrac * 100
          const height = Math.max(
            (stripe.endFrac - stripe.startFrac) * 100,
            (minH / editorHeight) * 100,
          )
          const isPinned = pinnedPos === stripe.fromPos
          return (
            <div
              key={i}
              className="absolute right-0 group/stripe"
              style={{ top: `${top}%`, height: `${height}%`, minHeight: minH, left: -38 }}
            >
              <div
                className={`absolute top-0 bottom-0 right-0 transition-opacity cursor-pointer ${isPinned ? 'opacity-100' : 'opacity-70 group-hover/stripe:opacity-100'}`}
                style={{ width: 22, backgroundColor: stripe.color }}
                onClick={() => onStripeClick(stripe.fromPos)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
