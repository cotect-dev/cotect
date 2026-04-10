import { memo, useState, useCallback, useRef, useMemo } from 'react'
import { useGitStore, type GitLogEntry } from '@/store/git'
import { invoke } from '@tauri-apps/api/core'
import RelativeTime from '@/components/RelativeTime'
import NoGitRepo from '@/components/NoGitRepo'

const CommitEntry = memo(function CommitEntry({ commit }: { commit: GitLogEntry }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className="px-2 py-1.5 border-b border-border/10 hover:bg-muted/30 cursor-pointer"
      role="button"
      tabIndex={0}
      onClick={() => setExpanded((v) => !v)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded((v) => !v) } }}
      aria-expanded={expanded}
    >
      <div className="flex items-center justify-between text-[10px] text-muted-foreground/50 font-mono">
        <span>{commit.hash}</span>
        <RelativeTime timestamp={commit.timestamp} />
      </div>
      <div className="text-xs mt-0.5 truncate">{commit.message}</div>
      <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground/50 font-mono">
        {commit.insertions > 0 && <span className="text-green-500">+{commit.insertions}</span>}
        {commit.deletions > 0 && <span className="text-red-500">-{commit.deletions}</span>}
        <span>· {commit.files.length} file{commit.files.length !== 1 ? 's' : ''}</span>
      </div>
      {expanded && commit.files.length > 0 && (
        <div className="mt-1.5 pl-2 border-l border-border/30 text-[10px] font-mono text-muted-foreground/70">
          {commit.files.map((f) => (
            <div key={f.path} className="flex items-center justify-between py-px">
              <span className="truncate">{f.path}</span>
              <div className="flex items-center gap-1 shrink-0 ml-2">
                {f.insertions > 0 && <span className="text-green-500">+{f.insertions}</span>}
                {f.deletions > 0 && <span className="text-red-500">-{f.deletions}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

export default function History() {
  const isGitRepo = useGitStore((s) => s.isGitRepo)
  const log = useGitStore((s) => s.log)
  const repoPath = useGitStore((s) => s.repoPath)
  // Only store *extra* commits loaded via infinite scroll — the base comes from the store.
  const [extraCommits, setExtraCommits] = useState<GitLogEntry[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [baseLog, setBaseLog] = useState(log)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Reset extra commits when the base log changes (new git refresh).
  // Adjusting state during render is the React-documented pattern for
  // resetting derived state — cheaper than a useEffect round-trip.
  if (log !== baseLog) {
    setBaseLog(log)
    setExtraCommits([])
    setHasMore(!!log && log.length >= 50)
  }

  const allCommits = useMemo(
    () => (log ? [...log, ...extraCommits] : extraCommits),
    [log, extraCommits],
  )

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !repoPath) return
    setLoadingMore(true)
    try {
      const currentTotal = (useGitStore.getState().log?.length ?? 0) + extraCommits.length
      const more = await invoke<GitLogEntry[]>('git_log', {
        repoPath,
        limit: 50,
        skip: currentTotal,
      })
      if (more.length < 50) setHasMore(false)
      setExtraCommits((prev) => [...prev, ...more])
    } catch {
      setHasMore(false)
    }
    setLoadingMore(false)
  }, [loadingMore, hasMore, repoPath, extraCommits.length])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      void loadMore()
    }
  }, [loadMore])

  if (!isGitRepo) return <NoGitRepo />

  if (allCommits.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No commits yet
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto"
        onScroll={handleScroll}
      >
        {allCommits.map((commit, i) => (
          <CommitEntry key={`${commit.hash}-${i}`} commit={commit} />
        ))}
        {loadingMore && (
          <div className="py-2 text-center text-xs text-muted-foreground">Loading...</div>
        )}
      </div>
    </div>
  )
}
