import { memo } from 'react'

interface CodeNodeHeaderProps {
  displayPath: string
  dirPrefix: string
  fileName: string
  isMd: boolean
  mdPreview: boolean
  onToggleMdPreview: () => void
  commitHash?: string
  isNewFile: boolean
  isReadOnly: boolean
  dirty: boolean
  saving: boolean
  editorFocused: boolean
  lineCount: number
  lineWrap: boolean
  onToggleLineWrap: () => void
  /** False for commit/range snapshots, which can never be edited. */
  canUnlock: boolean
  unlocked: boolean
  onToggleUnlocked: () => void
}

const badge = 'h-5 px-1.5 rounded font-mono text-[10px] leading-5'
const toggleBtn = (active: boolean) =>
  `${badge} cursor-pointer transition-colors ${
    active ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground hover:text-foreground'
  }`

/** Title bar for a CodeNode: file path, status badges (commit / new / modified /
 *  editing) and the markdown-preview and line-wrap toggles. Purely presentational. */
export const CodeNodeHeader = memo(function CodeNodeHeader({
  displayPath,
  dirPrefix,
  fileName,
  isMd,
  mdPreview,
  onToggleMdPreview,
  commitHash,
  isNewFile,
  isReadOnly,
  dirty,
  saving,
  editorFocused,
  lineCount,
  lineWrap,
  onToggleLineWrap,
  canUnlock,
  unlocked,
  onToggleUnlocked,
}: CodeNodeHeaderProps) {
  return (
    <div
      className="relative z-10 flex h-8 min-h-8 max-h-8 shrink-0 items-center overflow-hidden px-3 border-b border-border/50 bg-background"
      style={{
        backfaceVisibility: 'hidden',
        contain: 'layout paint style',
        isolation: 'isolate',
        transform: 'translateZ(0)',
        willChange: 'transform',
      }}
    >
      <div className="flex flex-1 items-center gap-2 min-w-0 overflow-hidden">
        <span
          className="block min-w-0 max-w-full text-xs leading-4 font-medium truncate"
          title={displayPath}
        >
          {dirPrefix && <span className="text-foreground/40">{dirPrefix}</span>}
          <span className="text-foreground">{fileName}</span>
        </span>
      </div>
      <div className="ml-2 flex items-center gap-1.5 shrink-0 overflow-hidden">
        {isMd && (
          <button type="button" onClick={onToggleMdPreview} className={toggleBtn(mdPreview)}>
            {mdPreview ? 'preview' : 'source'}
          </button>
        )}
        {commitHash && (
          <span className={`${badge} bg-blue-900/40 text-blue-400`}>{commitHash.slice(0, 7)}</span>
        )}
        {isNewFile && <span className={`${badge} bg-green-900/40 text-green-400`}>new</span>}
        {dirty && !isReadOnly && (
          <span className={`${badge} bg-yellow-800/40 text-yellow-400`}>
            {saving ? 'saving...' : 'modified'}
          </span>
        )}
        {editorFocused && !isReadOnly && (
          <span className={`${badge} bg-primary/20 text-primary`}>editing</span>
        )}
        {canUnlock && (
          <button
            type="button"
            onClick={onToggleUnlocked}
            className={toggleBtn(unlocked)}
            title={
              unlocked
                ? 'Lock editing: back to read-only'
                : 'Unlock editing: files open read-only so concurrent agent writes stay safe'
            }
          >
            {unlocked ? 'editable' : 'read-only'}
          </button>
        )}
        <button
          type="button"
          onClick={onToggleLineWrap}
          className={toggleBtn(lineWrap)}
          title={lineWrap ? 'Disable line wrapping' : 'Enable line wrapping'}
        >
          {lineCount}L{lineWrap ? '↩' : ''}
        </button>
      </div>
    </div>
  )
})
