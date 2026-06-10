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

const badge = 'text-[10px] px-1.5 py-0.5 rounded font-mono'
const toggleBtn = (active: boolean) =>
  `${badge} cursor-pointer transition-colors ${
    active ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground hover:text-foreground'
  }`

/** Title bar for a CodeNode: file path, status badges (commit / new / modified /
 *  editing) and the markdown-preview and line-wrap toggles. Purely presentational. */
export function CodeNodeHeader({
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
    <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50 bg-muted/30">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs font-medium truncate" title={displayPath}>
          {dirPrefix && <span className="text-foreground/40">{dirPrefix}</span>}
          <span className="text-foreground">{fileName}</span>
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
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
                ? 'Lock editing — back to read-only'
                : 'Unlock editing — files open read-only so concurrent agent writes stay safe'
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
}
