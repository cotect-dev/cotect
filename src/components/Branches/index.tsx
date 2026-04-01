import { useGitStore } from '@/store/git'
import NoGitRepo from '@/components/NoGitRepo'

export default function Branches() {
  const isGitRepo = useGitStore((s) => s.isGitRepo)
  const branch = useGitStore((s) => s.branch)

  if (!isGitRepo) return <NoGitRepo />

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 text-sm font-mono">
        <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
        <span className="truncate">{branch?.current ?? 'unknown'}</span>
      </div>
    </div>
  )
}
