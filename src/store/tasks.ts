import { create } from 'zustand'
import { createStoreWithHMR } from '@/lib/hmr'
import * as agentService from '@/services/agent'
import type { TaskEvent, AgentRole } from '@/services/agent'

// ─── Types ───────────────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'running' | 'completed' | 'errored' | 'interrupted'

export interface ToolActivity {
  tool_name: string
  file_path?: string
  description?: string
  success?: boolean
  output?: string
  timestamp: number
}

export interface TaskEntry {
  id: string
  prompt: string
  role: AgentRole
  status: TaskStatus
  text: string
  reasoning: string
  toolActivity: ToolActivity[]
  error?: string
  createdAt: number
  completedAt?: number
}

interface TasksState {
  tasks: TaskEntry[]
  /** Track active event listeners so we can clean up */
  _listeners: Record<string, () => void>

  createTask: (id: string, prompt: string, role: AgentRole, scope: agentService.TaskScope) => void
  abortTask: (id: string) => void
  clearCompleted: () => void
  removeTask: (id: string) => void
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useTasksStore = createStoreWithHMR(import.meta.hot, 'tasks', () =>
  create<TasksState>((set, get) => ({
    tasks: [],
    _listeners: {},

    createTask: (id, prompt, role, scope) => {
      const entry: TaskEntry = {
        id,
        prompt,
        role,
        status: 'pending',
        text: '',
        reasoning: '',
        toolActivity: [],
        createdAt: Date.now(),
      }

      set((s) => ({ tasks: [entry, ...s.tasks] }))

      // Start the backend task
      const request: agentService.TaskRequest = {
        id,
        prompt,
        scope,
        role,
      }

      agentService.startTask(request).then(() => {
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, status: 'running' as const } : t)),
        }))
      }).catch((err) => {
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, status: 'errored' as const, error: String(err) } : t,
          ),
        }))
      })

      // Subscribe to task events
      const unlisten = agentService.listenToTask(id, (event: TaskEvent) => {
        handleTaskEvent(id, event)
      })

      set((s) => ({
        _listeners: { ...s._listeners, [id]: unlisten },
      }))
    },

    abortTask: (id) => {
      agentService.abortTask(id).catch(console.error)
      // The Rust side will send an 'interrupted' event
    },

    clearCompleted: () => {
      const { tasks, _listeners } = get()
      const isActive = (t: TaskEntry) => t.status === 'running' || t.status === 'pending'
      for (const t of tasks) {
        if (!isActive(t)) _listeners[t.id]?.()
      }
      const keepIds = new Set(tasks.filter(isActive).map((t) => t.id))
      set({
        tasks: tasks.filter((t) => keepIds.has(t.id)),
        _listeners: Object.fromEntries(
          Object.entries(_listeners).filter(([k]) => keepIds.has(k)),
        ),
      })
    },

    removeTask: (id) => {
      get()._listeners[id]?.()
      set((s) => ({
        tasks: s.tasks.filter((t) => t.id !== id),
        _listeners: Object.fromEntries(
          Object.entries(s._listeners).filter(([k]) => k !== id),
        ),
      }))
    },
  })),
)

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Apply a partial update to a single task by id. */
function updateTask(taskId: string, updater: (task: TaskEntry) => Partial<TaskEntry>) {
  useTasksStore.setState((s) => ({
    tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...updater(t) } : t)),
  }))
}

/** Unsubscribe a task's event listener and remove it from the listener map. */
function detachListener(taskId: string) {
  const { _listeners } = useTasksStore.getState()
  _listeners[taskId]?.()
  useTasksStore.setState((s) => ({
    _listeners: Object.fromEntries(
      Object.entries(s._listeners).filter(([k]) => k !== taskId),
    ),
  }))
}

// ─── Event handler ───────────────────────────────────────────────────────────

function handleTaskEvent(taskId: string, event: TaskEvent) {
  const { tasks } = useTasksStore.getState()
  if (!tasks.find((t) => t.id === taskId)) return

  switch (event.type) {
    case 'text':
      updateTask(taskId, (t) => ({
        text: event.partial ? t.text + event.content : event.content,
      }))
      break

    case 'reasoning':
      updateTask(taskId, (t) => ({ reasoning: t.reasoning + event.content }))
      break

    case 'tool_start':
      updateTask(taskId, (t) => ({
        toolActivity: [
          ...t.toolActivity,
          {
            tool_name: event.tool_name,
            file_path: event.file_path,
            description: event.description,
            timestamp: Date.now(),
          },
        ],
      }))
      break

    case 'tool_end':
      updateTask(taskId, (t) => {
        const activity = [...t.toolActivity]
        for (let i = activity.length - 1; i >= 0; i--) {
          if (activity[i].tool_name === event.tool_name && activity[i].success === undefined) {
            activity[i] = { ...activity[i], success: event.success, output: event.output }
            break
          }
        }
        return { toolActivity: activity }
      })
      break

    case 'error':
      updateTask(taskId, () => ({ error: event.message }))
      break

    case 'complete':
      detachListener(taskId)
      updateTask(taskId, () => ({ status: 'completed' as const, completedAt: Date.now() }))
      break

    case 'interrupted':
      detachListener(taskId)
      updateTask(taskId, () => ({
        status: 'interrupted' as const,
        error: event.reason,
        completedAt: Date.now(),
      }))
      break
  }
}
