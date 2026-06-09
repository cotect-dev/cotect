import type { RefObject } from 'react'
import type { HunkDisplay } from './useReviewTarget'

export interface CommentDraft {
  startLine: number
  endLine: number
  snippet: string
  /** Id of the comment being edited, when re-opening an existing one. */
  editingId?: string
}

interface HunkReviewLayerProps {
  /** Translated imperatively on scroll; button tops are positioned by the caller. */
  layerRef: RefObject<HTMLDivElement | null>
  hunkDisplays: HunkDisplay[]
  onAccept: (hunk: HunkDisplay) => void
  onComment: (hunk: HunkDisplay) => void
  commentDraft: CommentDraft | null
  commentBody: string
  onCommentBodyChange: (body: string) => void
  onCancelComment: () => void
  onSubmitComment: () => void
}

/** Per-hunk Accept / Comment controls plus the inline comment composer, layered
 *  over the editor. Positioning (`top`) is owned imperatively by the caller. */
export function HunkReviewLayer({
  layerRef,
  hunkDisplays,
  onAccept,
  onComment,
  commentDraft,
  commentBody,
  onCommentBodyChange,
  onCancelComment,
  onSubmitComment,
}: HunkReviewLayerProps) {
  return (
    <div ref={layerRef} className="absolute inset-0 overflow-hidden pointer-events-none z-20">
      {hunkDisplays.map((h) => (
        <div
          key={h.startLine}
          data-hunk={h.startLine}
          className="absolute right-2 flex items-center gap-1 pointer-events-auto opacity-60 transition-opacity hover:opacity-100"
        >
          <button
            type="button"
            title={h.state === 'accepted' ? 'Accepted — click to undo' : 'Accept hunk'}
            onClick={() => onAccept(h)}
            className={`h-5 px-1.5 flex items-center gap-1 rounded border text-[10px] font-medium cursor-pointer shadow-sm ${
              h.state === 'accepted'
                ? 'bg-green-500/25 text-green-300 border-green-500/40'
                : 'bg-background/90 text-green-400 border-border hover:bg-green-900/60'
            }`}
          >
            ✓ {h.state === 'accepted' ? 'Accepted' : 'Accept'}
          </button>
          <button
            type="button"
            title="Decline & comment"
            onClick={() => onComment(h)}
            className={`h-5 px-1.5 flex items-center gap-1 rounded border text-[10px] font-medium cursor-pointer shadow-sm ${
              h.state === 'commented'
                ? 'bg-amber-500/25 text-amber-300 border-amber-500/40'
                : 'bg-background/90 text-red-400 border-border hover:bg-red-900/60'
            }`}
          >
            {h.state === 'commented' ? '💬 Comment' : '✕ Comment'}
          </button>
        </div>
      ))}
      {commentDraft && (
        <div
          data-hunk-comment={commentDraft.startLine}
          className="absolute right-2 w-[16rem] max-w-[calc(100%-1rem)] rounded border border-border bg-background shadow-lg p-2 pointer-events-auto opacity-60 transition-opacity hover:opacity-100 focus-within:opacity-100"
        >
          <div className="text-[10px] text-muted-foreground mb-1 font-mono">
            Lines {commentDraft.startLine}
            {commentDraft.endLine !== commentDraft.startLine ? `–${commentDraft.endLine}` : ''}
          </div>
          <textarea
            autoFocus
            value={commentBody}
            onChange={(e) => onCommentBodyChange(e.target.value)}
            placeholder="Comment for the agent…"
            className="w-full h-16 text-xs bg-muted/40 rounded p-1 outline-none resize-none"
          />
          <div className="flex justify-end gap-1 mt-1">
            <button
              type="button"
              onClick={onCancelComment}
              className="text-[10px] px-1.5 py-0.5 rounded hover:bg-muted cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!commentBody.trim()}
              onClick={onSubmitComment}
              className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary disabled:opacity-40 cursor-pointer"
            >
              {commentDraft.editingId ? 'Save' : 'Comment'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
