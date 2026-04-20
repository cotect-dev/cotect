import { useGitStore, branchLabel } from '@/store/git'
import NoGitRepo from '@/components/NoGitRepo'

const DOT_COLOR: Record<'branch' | 'detached' | 'initial', string> = {
  branch: 'bg-blue-500',
  detached: 'bg-amber-500',
  initial: 'bg-muted-foreground/40',
}

export default function Branches() {
  const isGitRepo = useGitStore((s) => s.isGitRepo)
  const branch = useGitStore((s) => s.branch)

  if (!isGitRepo) return <NoGitRepo />

  const dot = branch ? DOT_COLOR[branch.kind] : DOT_COLOR.branch

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 text-sm font-mono">
        <div className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        <span className="truncate">{branchLabel(branch)}</span>
      </div>
    </div>
  )
}
