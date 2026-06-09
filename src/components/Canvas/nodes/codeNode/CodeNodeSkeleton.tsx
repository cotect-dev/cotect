/** Placeholder shown while the CodeMirror editor mounts: gutter line numbers
 *  plus pseudo-random shimmer bars so the node has stable height immediately. */
export function CodeNodeSkeleton({
  lineCount,
  startLine,
}: {
  lineCount: number
  startLine: number
}) {
  const visibleLines = Math.min(lineCount, 40)
  return (
    <div
      className="overflow-hidden"
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: '12px',
        lineHeight: '18px',
      }}
    >
      {Array.from({ length: visibleLines }, (_, i) => {
        const lineNum = startLine + i
        const widthPercent = 20 + ((lineNum * 7) % 60)
        return (
          <div key={i} className="flex" style={{ height: 18 }}>
            <span
              className="text-right shrink-0 select-none text-muted-foreground/30"
              style={{ width: 40, paddingRight: 8, fontSize: '12px' }}
            >
              {lineNum}
            </span>
            <div
              className="rounded bg-foreground/[0.04]"
              style={{ width: `${widthPercent}%`, height: 10, marginTop: 4 }}
            />
          </div>
        )
      })}
    </div>
  )
}
