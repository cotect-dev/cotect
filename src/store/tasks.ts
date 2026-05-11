import { create } from 'zustand'
import { createStoreWithHMR } from '@/lib/hmr'
import * as agentService from '@/services/agent'
import type { TaskEvent, AgentRole } from '@/services/agent'

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
  lastFollowup?: { question: string; options?: string[] }
  createdAt: number
  completedAt?: number
}

interface TasksState {
  tasks: TaskEntry[]

  createTask: (id: string, prompt: string, role: AgentRole, scope: agentService.TaskScope) => void
  abortTask: (id: string) => void
  clearCompleted: () => void
  clearAll: () => void
  removeTask: (id: string) => void
}

const taskListeners = new Map<string, () => void>()

export const useTasksStore = createStoreWithHMR(import.meta.hot, 'tasks', () =>
  create<TasksState>((set, get) => ({
    tasks: [],

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

      const request: agentService.TaskRequest = {
        id,
        prompt,
        scope,
        role,
      }

      agentService
        .startTask(request)
        .then(() => {
          set((s) => ({
            tasks: s.tasks.map((t) => (t.id === id ? { ...t, status: 'running' as const } : t)),
          }))
        })
        .catch((err) => {
          taskListeners.get(id)?.()
          taskListeners.delete(id)
          set((s) => ({
            tasks: s.tasks.map((t) =>
              t.id === id ? { ...t, status: 'errored' as const, error: String(err) } : t,
            ),
          }))
        })

      const unlisten = agentService.listenToTask(id, (event) => {
        handleTaskEvent(id, event)
      })

      taskListeners.set(id, unlisten)
    },

    abortTask: (id) => {
      // Rust side responds with an 'interrupted' event.
      agentService.abortTask(id).catch(console.error)
    },

    clearCompleted: () => {
      const { tasks } = get()
      const isActive = (t: TaskEntry) => t.status === 'running' || t.status === 'pending'
      for (const t of tasks) {
        if (!isActive(t)) {
          taskListeners.get(t.id)?.()
          taskListeners.delete(t.id)
        }
      }
      set({
        tasks: tasks.filter((t) => isActive(t)),
      })
    },

    clearAll: () => {
      const { tasks } = get()
      for (const t of tasks) {
        if (t.status === 'running' || t.status === 'pending') {
          agentService.abortTask(t.id).catch(console.error)
        }
        taskListeners.get(t.id)?.()
        taskListeners.delete(t.id)
      }
      set({ tasks: [] })
    },

    removeTask: (id) => {
      taskListeners.get(id)?.()
      taskListeners.delete(id)
      set((s) => ({
        tasks: s.tasks.filter((t) => t.id !== id),
      }))
    },
  })),
)

function updateTask(taskId: string, updater: (task: TaskEntry) => Partial<TaskEntry>) {
  useTasksStore.setState((s) => ({
    tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...updater(t) } : t)),
  }))
}

function detachListener(taskId: string) {
  taskListeners.get(taskId)?.()
  taskListeners.delete(taskId)
}

function handleTaskEvent(taskId: string, event: TaskEvent) {
  const { tasks } = useTasksStore.getState()
  if (!tasks.some((t) => t.id === taskId)) return

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

    case 'followup':
      updateTask(taskId, () => ({
        lastFollowup: { question: event.question, options: event.options },
      }))
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

    case 'reasoning_stall':
      // No-op for now: the existing reasoning stream is already visible.
      // Reserved for a future "model is deliberating" indicator.
      break
  }
}
