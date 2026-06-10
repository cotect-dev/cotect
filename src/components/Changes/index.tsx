import { memo, useMemo } from 'react'
import { useGitStore, sortedFiles, type GitFileStatus } from '@/store/git'
import { useCanvasStore } from '@/store/canvas'
import { basename } from '@/lib/repoPath'
import {
  useReviewStore,
  isCommitReview,
  fileProgress,
  overallProgress,
  workingSessionOf,
  type ReviewComment,
  type ReviewFile,
  type ReviewSession,
} from '@/store/review'
import NoGitRepo from '@/components/NoGitRepo'

interface TreeNode {
  name: string
  path: string
  file?: GitFileStatus
  children: TreeNode[]
}

function buildCompactTree(files: GitFileStatus[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] }

  for (const file of files) {
    const parts = file.path.split('/')
    let current = root
    for (let i = 0; i < parts.length - 1; i++) {
      let child = current.children.find((c) => c.name === parts[i] && !c.file)
      if (!child) {
        child = { name: parts[i], path: parts.slice(0, i + 1).join('/'), children: [] }
        current.children.push(child)
      }
      current = child
    }
    current.children.push({
      name: parts[parts.length - 1],
      path: file.path,
      file,
      children: [],
    })
  }

  function collapse(node: TreeNode): TreeNode {
    node.children = node.children.map(collapse)
    if (!node.file && node.children.length === 1 && !node.children[0].file) {
      const child = node.children[0]
      return { ...child, name: `${node.name}/${child.name}` }
    }
    return node
  }

  return collapse(root).children
}

const statusColors: Record<string, string> = {
  M: 'text-yellow-500',
  A: 'text-green-500',
  U: 'text-green-500', // untracked (porcelain `??`) — rendered as addition
  D: 'text-red-500',
  R: 'text-blue-500',
  '??': 'text-muted-foreground',
}

type HunkProgress = { reviewed: number; total: number }

const FileEntry = memo(function FileEntry({
  file,
  showFullPath,
  progress,
}: {
  file: GitFileStatus
  showFullPath?: boolean
  progress?: HunkProgress
}) {
  const handleClick = () => {
    void useCanvasStore.getState().focusFileByPath(file.path)
  }
  const displayName = showFullPath ? file.path : basename(file.path)
  const truncateStyle: React.CSSProperties = showFullPath
    ? { direction: 'rtl', textAlign: 'left', unicodeBidi: 'plaintext' }
    : {}
  const done = progress !== undefined && progress.total > 0 && progress.reviewed === progress.total
  return (
    <div
      className="flex items-center justify-between gap-2 px-2 py-px hover:bg-primary/10 cursor-pointer text-xs font-mono"
      onClick={handleClick}
      title={file.path}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className={`shrink-0 w-4 text-center ${statusColors[file.status] ?? 'text-muted-foreground'}`}
        >
          {file.status}
        </span>
        <span
          className={`truncate ${done ? 'text-muted-foreground/50' : ''}`}
          style={truncateStyle}
        >
          {displayName}
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0 text-[10px]">
        {progress !== undefined && progress.total > 0 && (
          <span className={done ? 'text-green-500' : 'text-muted-foreground/60'}>
            {progress.reviewed}/{progress.total}
          </span>
        )}
        {file.insertions > 0 && <span className="text-green-500">+{file.insertions}</span>}
        {file.deletions > 0 && <span className="text-red-500">-{file.deletions}</span>}
      </div>
    </div>
  )
})

const TreeEntry = memo(function TreeEntry({
  node,
  depth,
  progressByPath,
}: {
  node: TreeNode
  depth: number
  progressByPath: Map<string, HunkProgress>
}) {
  if (node.file) {
    return (
      <div style={{ paddingLeft: depth * 12 }}>
        <FileEntry file={node.file} progress={progressByPath.get(node.file.path)} />
      </div>
    )
  }

  return (
    <>
      <div
        className="px-2 py-px text-[11px] text-muted-foreground/50 font-mono"
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        {node.name}/
      </div>
      {node.children.map((child) => (
        <TreeEntry
          key={child.path}
          node={child}
          depth={depth + 1}
          progressByPath={progressByPath}
        />
      ))}
    </>
  )
})

const ReviewFileEntry = memo(function ReviewFileEntry({
  file,
  session,
}: {
  file: ReviewFile
  session: ReviewSession
}) {
  const { reviewed, total } = fileProgress(session, file)
  const done = total > 0 && reviewed === total
  const open = () => {
    void useCanvasStore.getState().showRangeDiff(file.path, session.baseRef, session.tipSha)
  }
  return (
    <div
      className="flex items-center gap-2 px-2 py-px hover:bg-primary/10 cursor-pointer text-xs font-mono"
      onClick={open}
      title={file.path}
    >
      <span
        className={`shrink-0 w-4 text-center ${statusColors[file.status] ?? 'text-muted-foreground'}`}
      >
        {file.status}
      </span>
      <span className={`truncate ${done ? 'text-muted-foreground/50' : ''}`}>
        {basename(file.path)}
      </span>
      <span
        className={`ml-auto shrink-0 text-[10px] ${done ? 'text-green-500' : 'text-muted-foreground/60'}`}
      >
        {reviewed}/{total}
      </span>
    </div>
  )
})

const CommentsSection = memo(function CommentsSection({
  comments,
  onOpen,
}: {
  comments: ReviewComment[]
  onOpen: (comment: ReviewComment) => void
}) {
  return (
    <div className="mt-2 border-t border-border/30 pt-1">
      <div className="flex items-center justify-between px-2 py-1 text-[10px] text-muted-foreground/60">
        <span>
          {comments.length} comment{comments.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => {
            const md = useReviewStore.getState().exportCommentsMarkdown()
            void navigator.clipboard.writeText(md)
          }}
          className="px-1.5 py-0.5 rounded hover:bg-muted/50 font-mono text-[10px] cursor-pointer"
          title="Copy all comments as markdown"
        >
          Copy all
        </button>
      </div>
      {comments.map((c) => (
        <div
          key={c.id}
          className="px-2 py-1 text-[11px] hover:bg-muted/20 cursor-pointer"
          onClick={() => onOpen(c)}
        >
          <div className="flex items-center justify-between text-[10px] text-muted-foreground/60 font-mono">
            <span className="truncate">
              {basename(c.filePath)}:{c.startLine}
              {c.endLine !== c.startLine ? `-${c.endLine}` : ''}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                useReviewStore.getState().removeComment(c.id)
              }}
              className="px-1 rounded hover:bg-red-900/40 hover:text-red-400 cursor-pointer"
              title="Delete comment"
            >
              ✕
            </button>
          </div>
          <div className="mt-0.5 break-words">{c.body}</div>
        </div>
      ))}
    </div>
  )
})

export default function Changes() {
  const isGitRepo = useGitStore((s) => s.isGitRepo)
  const status = useGitStore((s) => s.status)
  const fileTimes = useGitStore((s) => s.fileTimes)
  const sortMode = useGitStore((s) => s.sortMode)
  const setSortMode = useGitStore((s) => s.setSortMode)
  const workingDiff = useGitStore((s) => s.workingDiff)
  const headSha = useGitStore((s) => s.log?.[0]?.hash)
  const review = useReviewStore((s) => s.active)
  // A commit-baseline review (from History) replaces the panel with its own diff
  // file list + read-only range diffs. An implicit working-tree review only
  // annotates the live changes, so the working-tree list below stays visible.
  const commitReview = review && isCommitReview(review) ? review : null
  const workingSession = useReviewStore((s) => workingSessionOf(s, headSha))
  const workingComments = commitReview ? [] : (workingSession?.comments ?? [])

  // Per-file and overall hunk progress over the live working tree, counted
  // against git's own hunk ranges (same keys the editor's accept buttons use).
  const workingProgress = useMemo(() => {
    const byPath = new Map<string, HunkProgress>()
    for (const f of workingDiff) {
      byPath.set(
        f.path,
        workingSession ? fileProgress(workingSession, f) : { reviewed: 0, total: f.hunks.length },
      )
    }
    return byPath
  }, [workingDiff, workingSession])
  const workingOverall = useMemo(() => {
    let reviewed = 0
    let total = 0
    for (const p of workingProgress.values()) {
      reviewed += p.reviewed
      total += p.total
    }
    return { reviewed, total }
  }, [workingProgress])

  const tree = useMemo(
    () => (status && sortMode === 'path' ? buildCompactTree(status.files) : []),
    [status, sortMode],
  )

  const flatSorted = useMemo(
    () => (status && sortMode !== 'path' ? sortedFiles({ status, fileTimes, sortMode }) : []),
    [status, fileTimes, sortMode],
  )

  const cycleSortMode = () => {
    const next: Record<typeof sortMode, typeof sortMode> = {
      path: 'recent',
      recent: 'oldest',
      oldest: 'path',
    }
    setSortMode(next[sortMode])
  }

  const sortLabel: Record<typeof sortMode, string> = {
    path: 'Path',
    recent: 'Recent',
    oldest: 'Oldest',
  }

  // Commit-baseline review: dedicated view over the diff-since-baseline files.
  if (commitReview) {
    const progress = overallProgress(commitReview)
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-2 py-1 text-[11px] border-b border-border/30 bg-primary/10">
          <span
            className="text-primary truncate"
            title={`Reviewing since ${commitReview.baseCommit}`}
          >
            Review · {commitReview.baseCommit.slice(0, 7)} · {progress.reviewed}/{progress.total}{' '}
            hunks
          </span>
          <button
            onClick={() => useReviewStore.getState().exitReview()}
            className="px-1.5 py-0.5 rounded hover:bg-muted/50 font-mono text-[10px] cursor-pointer"
            title="Exit review"
          >
            Exit
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto py-1">
          {commitReview.files.map((file) => (
            <ReviewFileEntry key={file.path} file={file} session={commitReview} />
          ))}
          {commitReview.comments.length > 0 && (
            <CommentsSection
              comments={commitReview.comments}
              onOpen={(c) =>
                void useCanvasStore
                  .getState()
                  .showRangeDiff(c.filePath, commitReview.baseRef, commitReview.tipSha)
              }
            />
          )}
        </div>
      </div>
    )
  }

  if (!isGitRepo) return <NoGitRepo />

  const files = status?.files ?? []

  // Working-tree changes — always shown. An implicit review's comments (if any)
  // layer underneath without hiding the file list.
  if (files.length === 0 && workingComments.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No changes
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {files.length > 0 && (
        <div className="flex items-center justify-between px-2 py-1 text-[11px] text-muted-foreground/60 border-b border-border/30">
          <span>
            {files.length} file{files.length !== 1 ? 's' : ''} changed
            {workingOverall.total > 0 && (
              <span
                className={
                  workingOverall.reviewed === workingOverall.total ? 'text-green-500' : undefined
                }
              >
                {' '}
                · {workingOverall.reviewed}/{workingOverall.total} hunks
              </span>
            )}
          </span>
          <button
            onClick={cycleSortMode}
            className="px-1.5 py-0.5 rounded hover:bg-muted/50 font-mono text-[10px] cursor-pointer"
            title="Toggle sort mode"
          >
            {sortLabel[sortMode]}
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {sortMode === 'path'
          ? tree.map((node) => (
              <TreeEntry key={node.path} node={node} depth={0} progressByPath={workingProgress} />
            ))
          : flatSorted.map((file) => (
              <FileEntry
                key={file.path}
                file={file}
                showFullPath
                progress={workingProgress.get(file.path)}
              />
            ))}
        {workingComments.length > 0 && (
          <CommentsSection
            comments={workingComments}
            onOpen={(c) => void useCanvasStore.getState().focusFileByPath(c.filePath, c.startLine)}
          />
        )}
      </div>
    </div>
  )
}
