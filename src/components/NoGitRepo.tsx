import { useGitStore } from '@/store/git'
import { Button } from '@/components/ui/button'

export default function NoGitRepo() {
  const initialized = useGitStore((s) => s.initialized)
  const gitError = useGitStore((s) => s.gitError)
  const initRepo = useGitStore((s) => s.initRepo)

  if (!initialized) return null

  if (gitError === 'GIT_NOT_FOUND') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground text-sm">
        Git not found
      </div>
    )
  }

  if (gitError === 'GIT_TIMEOUT') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground text-sm">
        Git command timed out
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground text-sm">
      <span>Not a git repository</span>
      <Button size="sm" onClick={initRepo}>
        Initialize Repository
      </Button>
    </div>
  )
}
