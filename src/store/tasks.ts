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
      const toRemove = tasks.filter((t) => t.status !== 'running' && t.status !== 'pending')
      for (const t of toRemove) {
        _listeners[t.id]?.()
      }
      const remaining = tasks.filter((t) => t.status === 'running' || t.status === 'pending')
      const remainingListeners = { ..._listeners }
      for (const t of toRemove) {
        delete remainingListeners[t.id]
      }
      set({ tasks: remaining, _listeners: remainingListeners })
    },

    removeTask: (id) => {
      const { _listeners } = get()
      _listeners[id]?.()
      set((s) => ({
        tasks: s.tasks.filter((t) => t.id !== id),
        _listeners: Object.fromEntries(
          Object.entries(s._listeners).filter(([k]) => k !== id),
        ),
      }))
    },
  })),
)

// ─── Event handler ───────────────────────────────────────────────────────────

function handleTaskEvent(taskId: string, event: TaskEvent) {
  const { tasks, _listeners } = useTasksStore.getState()

  // Find the task — bail if it's already been removed
  if (!tasks.find((t) => t.id === taskId)) return

  switch (event.type) {
    case 'text':
      if (event.partial) {
        // Streaming delta — append
        useTasksStore.setState((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId ? { ...t, text: t.text + event.content } : t,
          ),
        }))
      } else {
        // Full text — replace
        useTasksStore.setState((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId ? { ...t, text: event.content } : t,
          ),
        }))
      }
      break

    case 'reasoning':
      useTasksStore.setState((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === taskId ? { ...t, reasoning: t.reasoning + event.content } : t,
        ),
      }))
      break

    case 'tool_start':
      useTasksStore.setState((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                toolActivity: [
                  ...t.toolActivity,
                  {
                    tool_name: event.tool_name,
                    file_path: event.file_path,
                    description: event.description,
                    timestamp: Date.now(),
                  },
                ],
              }
            : t,
        ),
      }))
      break

    case 'tool_end': {
      useTasksStore.setState((s) => ({
        tasks: s.tasks.map((t) => {
          if (t.id !== taskId) return t
          // Update the last matching tool_start entry
          const activity = [...t.toolActivity]
          for (let i = activity.length - 1; i >= 0; i--) {
            if (activity[i].tool_name === event.tool_name && activity[i].success === undefined) {
              activity[i] = {
                ...activity[i],
                success: event.success,
                output: event.output,
              }
              break
            }
          }
          return { ...t, toolActivity: activity }
        }),
      }))
      break
    }

    case 'error':
      useTasksStore.setState((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === taskId ? { ...t, error: event.message } : t,
        ),
      }))
      break

    case 'complete':
      _listeners[taskId]?.()
      useTasksStore.setState((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === taskId
            ? { ...t, status: 'completed' as const, completedAt: Date.now() }
            : t,
        ),
        _listeners: Object.fromEntries(
          Object.entries(s._listeners).filter(([k]) => k !== taskId),
        ),
      }))
      break

    case 'interrupted':
      _listeners[taskId]?.()
      useTasksStore.setState((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === taskId
            ? { ...t, status: 'interrupted' as const, error: event.reason, completedAt: Date.now() }
            : t,
        ),
        _listeners: Object.fromEntries(
          Object.entries(s._listeners).filter(([k]) => k !== taskId),
        ),
      }))
      break
  }
}
