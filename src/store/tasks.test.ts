import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useTasksStore } from './tasks'
import * as agentService from '@/services/agent'

// Mock the agent service
vi.mock('@/services/agent', () => ({
  startTask: vi.fn(),
  abortTask: vi.fn(),
  listenToTask: vi.fn(() => vi.fn()),
}))

describe('useTasksStore', () => {
  beforeEach(() => {
    useTasksStore.setState({
      tasks: [],
      _listeners: {},
    })
    vi.clearAllMocks()
  })

  describe('createTask', () => {
    it('adds a pending task to the store', () => {
      vi.mocked(agentService.startTask).mockResolvedValue(undefined)

      useTasksStore.getState().createTask('t1', 'Fix bug', 'implement', {
        root_path: '/project',
        files: [],
      })

      const { tasks } = useTasksStore.getState()
      expect(tasks).toHaveLength(1)
      expect(tasks[0].id).toBe('t1')
      expect(tasks[0].prompt).toBe('Fix bug')
      expect(tasks[0].role).toBe('implement')
      expect(tasks[0].status).toBe('pending')
      expect(tasks[0].text).toBe('')
      expect(tasks[0].reasoning).toBe('')
      expect(tasks[0].toolActivity).toEqual([])
    })

    it('calls agentService.startTask', () => {
      vi.mocked(agentService.startTask).mockResolvedValue(undefined)

      useTasksStore.getState().createTask('t1', 'Fix bug', 'implement', {
        root_path: '/project',
        files: ['src/main.ts'],
      })

      expect(agentService.startTask).toHaveBeenCalledWith({
        id: 't1',
        prompt: 'Fix bug',
        scope: { root_path: '/project', files: ['src/main.ts'] },
        role: 'implement',
      })
    })

    it('subscribes to task events via listenToTask', () => {
      vi.mocked(agentService.startTask).mockResolvedValue(undefined)

      useTasksStore.getState().createTask('t1', 'Test', 'research', {
        root_path: '/project',
        files: [],
      })

      expect(agentService.listenToTask).toHaveBeenCalledWith('t1', expect.any(Function))
    })

    it('prepends new tasks (most recent first)', () => {
      vi.mocked(agentService.startTask).mockResolvedValue(undefined)

      useTasksStore.getState().createTask('t1', 'First', 'implement', { root_path: '/p', files: [] })
      useTasksStore.getState().createTask('t2', 'Second', 'plan', { root_path: '/p', files: [] })

      const { tasks } = useTasksStore.getState()
      expect(tasks[0].id).toBe('t2')
      expect(tasks[1].id).toBe('t1')
    })

    it('marks task as errored when startTask fails', async () => {
      vi.mocked(agentService.startTask).mockRejectedValue(new Error('No provider'))

      useTasksStore.getState().createTask('t1', 'Test', 'implement', { root_path: '/p', files: [] })

      // Wait for the async error handler
      await vi.waitFor(() => {
        const { tasks } = useTasksStore.getState()
        expect(tasks[0].status).toBe('errored')
      })
    })
  })

  describe('abortTask', () => {
    it('calls agentService.abortTask', () => {
      vi.mocked(agentService.abortTask).mockResolvedValue(undefined)

      useTasksStore.getState().abortTask('t1')

      expect(agentService.abortTask).toHaveBeenCalledWith('t1')
    })
  })

  describe('clearCompleted', () => {
    it('removes non-running tasks', () => {
      useTasksStore.setState({
        tasks: [
          { id: 't1', prompt: 'A', role: 'implement', status: 'completed', text: '', reasoning: '', toolActivity: [], createdAt: 0 },
          { id: 't2', prompt: 'B', role: 'implement', status: 'running', text: '', reasoning: '', toolActivity: [], createdAt: 0 },
          { id: 't3', prompt: 'C', role: 'implement', status: 'errored', text: '', reasoning: '', toolActivity: [], createdAt: 0 },
        ],
        _listeners: {},
      })

      useTasksStore.getState().clearCompleted()

      const { tasks } = useTasksStore.getState()
      expect(tasks).toHaveLength(1)
      expect(tasks[0].id).toBe('t2')
    })

    it('preserves pending tasks', () => {
      useTasksStore.setState({
        tasks: [
          { id: 't1', prompt: 'A', role: 'implement', status: 'pending', text: '', reasoning: '', toolActivity: [], createdAt: 0 },
          { id: 't2', prompt: 'B', role: 'implement', status: 'completed', text: '', reasoning: '', toolActivity: [], createdAt: 0 },
        ],
        _listeners: {},
      })

      useTasksStore.getState().clearCompleted()

      const { tasks } = useTasksStore.getState()
      expect(tasks).toHaveLength(1)
      expect(tasks[0].id).toBe('t1')
    })
  })

  describe('removeTask', () => {
    it('removes a specific task', () => {
      const unlisten = vi.fn()
      useTasksStore.setState({
        tasks: [
          { id: 't1', prompt: 'A', role: 'implement', status: 'completed', text: '', reasoning: '', toolActivity: [], createdAt: 0 },
          { id: 't2', prompt: 'B', role: 'implement', status: 'completed', text: '', reasoning: '', toolActivity: [], createdAt: 0 },
        ],
        _listeners: { t1: unlisten },
      })

      useTasksStore.getState().removeTask('t1')

      const { tasks, _listeners } = useTasksStore.getState()
      expect(tasks).toHaveLength(1)
      expect(tasks[0].id).toBe('t2')
      expect(unlisten).toHaveBeenCalled()
      expect(_listeners['t1']).toBeUndefined()
    })
  })
})
