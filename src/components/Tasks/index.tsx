import { memo, useState, useCallback, useEffect } from 'react'
import { useTasksStore, type TaskEntry, type TaskStatus } from '@/store/tasks'
import { useBrowserStore } from '@/store/browser'
import type { AgentRole } from '@/services/agent'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

// ─── Status badge ────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<TaskStatus, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  running: 'bg-blue-500/20 text-blue-400',
  completed: 'bg-green-500/20 text-green-400',
  errored: 'bg-red-500/20 text-red-400',
  interrupted: 'bg-orange-500/20 text-orange-400',
}

function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_STYLES[status]}`}>
      {status === 'running' && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
      )}
      {status}
    </span>
  )
}

// ─── Tool activity display ───────────────────────────────────────────────────

function ToolActivityList({ task }: { task: TaskEntry }) {
  const recent = task.toolActivity.slice(-5)
  if (recent.length === 0) return null

  return (
    <div className="flex flex-col gap-0.5 mt-1">
      {recent.map((a, i) => (
        <div key={`${a.tool_name}-${a.timestamp}-${i}`} className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
          <span className={a.success === undefined ? 'text-blue-400' : a.success ? 'text-green-400' : 'text-red-400'}>
            {a.success === undefined ? '...' : a.success ? 'ok' : 'err'}
          </span>
          <span className="text-foreground/70">{a.tool_name}</span>
          {a.file_path && (
            <span className="truncate max-w-[160px] text-muted-foreground/60">{a.file_path.split('/').pop()}</span>
          )}
        </div>
      ))}
      {task.toolActivity.length > 5 && (
        <span className="text-[10px] text-muted-foreground/40">+{task.toolActivity.length - 5} more</span>
      )}
    </div>
  )
}

// ─── Task card ───────────────────────────────────────────────────────────────

const TaskCard = memo(function TaskCard({ task }: { task: TaskEntry }) {
  const abortTask = useTasksStore((s) => s.abortTask)
  const removeTask = useTasksStore((s) => s.removeTask)
  const [expanded, setExpanded] = useState(false)

  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (task.status !== 'running') return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [task.status])

  const isActive = task.status === 'running' || task.status === 'pending'
  const elapsed = task.completedAt
    ? formatDuration(task.completedAt - task.createdAt)
    : task.status === 'running'
      ? formatDuration(now - task.createdAt)
      : null

  return (
    <div className="rounded-lg border border-border bg-card p-2.5 flex flex-col gap-1">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <StatusBadge status={task.status} />
            <span className="text-[10px] text-muted-foreground/50 font-mono">{task.role}</span>
            {elapsed && <span className="text-[10px] text-muted-foreground/40">{elapsed}</span>}
          </div>
          <p className="text-xs text-foreground truncate" title={task.prompt}>
            {task.prompt}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isActive && (
            <Button size="sm" variant="destructive" onClick={() => abortTask(task.id)} className="h-6 px-2 text-[10px]">
              Stop
            </Button>
          )}
          {!isActive && (
            <Button size="sm" variant="ghost" onClick={() => removeTask(task.id)} className="h-6 px-2 text-[10px]">
              Remove
            </Button>
          )}
        </div>
      </div>

      {/* Tool activity */}
      {isActive && <ToolActivityList task={task} />}

      {/* Error display */}
      {task.error && (
        <div className="text-[10px] text-red-400 bg-red-500/10 rounded px-2 py-1 mt-0.5">{task.error}</div>
      )}

      {/* Expandable output */}
      {task.text && (
        <div>
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide task output' : 'Show task output'}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? 'Hide output' : 'Show output'}
          </button>
          {expanded && (
            <div className="mt-1 text-xs text-foreground/80 bg-muted/50 rounded p-2 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
              {task.text}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

// ─── New task form ───────────────────────────────────────────────────────────

function NewTaskForm() {
  const [prompt, setPrompt] = useState('')
  const [role, setRole] = useState<AgentRole>('implement')
  const createTask = useTasksStore((s) => s.createTask)
  const rootPath = useBrowserStore((s) => s.rootPath)

  const handleSubmit = useCallback(() => {
    const trimmed = prompt.trim()
    if (!trimmed || !rootPath) return

    const id = crypto.randomUUID()
    createTask(id, trimmed, role, {
      root_path: rootPath,
      files: [],
    })
    setPrompt('')
  }, [prompt, role, rootPath, createTask])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  if (!rootPath) {
    return (
      <div className="text-xs text-muted-foreground text-center py-2">
        Open a project folder to use the agent.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        {(['implement', 'research', 'plan'] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRole(r)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              role === r
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      <div className="flex gap-2 items-end">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe what you want the agent to do..."
          rows={2}
          className="flex-1 min-h-0 resize-none text-xs"
        />
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!prompt.trim()}
          className="shrink-0"
        >
          Run
        </Button>
      </div>
    </div>
  )
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export default function Tasks() {
  const tasks = useTasksStore((s) => s.tasks)
  const clearCompleted = useTasksStore((s) => s.clearCompleted)

  const hasCompleted = tasks.some((t) => t.status !== 'running' && t.status !== 'pending')

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Task list */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 pr-1">
        {tasks.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
            No agent tasks yet
          </div>
        )}
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
      </div>

      {/* Clear button */}
      {hasCompleted && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={clearCompleted}
            className="h-6 px-2 text-[10px] text-muted-foreground"
          >
            Clear finished
          </Button>
        </div>
      )}

      {/* New task form */}
      <NewTaskForm />
    </div>
  )
}

// ─── Utils ───────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}
