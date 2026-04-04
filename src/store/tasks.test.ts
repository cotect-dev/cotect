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

    it('calls unlisten for removed tasks', () => {
      const unlisten1 = vi.fn()
      const unlisten2 = vi.fn()
      useTasksStore.setState({
        tasks: [
          { id: 't1', prompt: 'A', role: 'implement', status: 'completed', text: '', reasoning: '', toolActivity: [], createdAt: 0 },
          { id: 't2', prompt: 'B', role: 'implement', status: 'running', text: '', reasoning: '', toolActivity: [], createdAt: 0 },
        ],
        _listeners: { t1: unlisten1, t2: unlisten2 },
      })

      useTasksStore.getState().clearCompleted()
      expect(unlisten1).toHaveBeenCalled()
      expect(unlisten2).not.toHaveBeenCalled()
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

  // ─── Event handler integration tests ──────────────────────────────────

  describe('handleTaskEvent (via listenToTask callback)', () => {
    /** Helper to get the event callback that was passed to listenToTask */
    function getEventCallback(): (event: agentService.TaskEvent) => void {
      vi.mocked(agentService.startTask).mockResolvedValue(undefined)
      let callback: ((event: agentService.TaskEvent) => void) | undefined
      vi.mocked(agentService.listenToTask).mockImplementation((_id, cb) => {
        callback = cb
        return vi.fn()
      })
      useTasksStore.getState().createTask('t1', 'Test', 'implement', { root_path: '/p', files: [] })
      return callback!
    }

    it('handles text event (partial=true) - appends to existing text', () => {
      const cb = getEventCallback()
      cb({ type: 'text', content: 'Hello ', partial: true })
      cb({ type: 'text', content: 'world!', partial: true })

      const task = useTasksStore.getState().tasks[0]
      expect(task.text).toBe('Hello world!')
    })

    it('handles text event (partial=false) - replaces text', () => {
      const cb = getEventCallback()
      cb({ type: 'text', content: 'partial', partial: true })
      cb({ type: 'text', content: 'Complete response', partial: false })

      const task = useTasksStore.getState().tasks[0]
      expect(task.text).toBe('Complete response')
    })

    it('handles reasoning events - accumulates', () => {
      const cb = getEventCallback()
      cb({ type: 'reasoning', content: 'Step 1. ' })
      cb({ type: 'reasoning', content: 'Step 2.' })

      const task = useTasksStore.getState().tasks[0]
      expect(task.reasoning).toBe('Step 1. Step 2.')
    })

    it('handles tool_start event', () => {
      const cb = getEventCallback()
      cb({ type: 'tool_start', tool_name: 'read', file_path: '/tmp/test.txt', description: 'Reading file' })

      const task = useTasksStore.getState().tasks[0]
      expect(task.toolActivity).toHaveLength(1)
      expect(task.toolActivity[0].tool_name).toBe('read')
      expect(task.toolActivity[0].file_path).toBe('/tmp/test.txt')
      expect(task.toolActivity[0].success).toBeUndefined()
    })

    it('handles tool_end event - matches to tool_start', () => {
      const cb = getEventCallback()
      cb({ type: 'tool_start', tool_name: 'read', file_path: '/tmp/test.txt' })
      cb({ type: 'tool_end', tool_name: 'read', file_path: '/tmp/test.txt', success: true, output: 'file contents' })

      const task = useTasksStore.getState().tasks[0]
      expect(task.toolActivity).toHaveLength(1)
      expect(task.toolActivity[0].success).toBe(true)
      expect(task.toolActivity[0].output).toBe('file contents')
    })

    it('handles multiple sequential tool calls', () => {
      const cb = getEventCallback()
      // First tool: read
      cb({ type: 'tool_start', tool_name: 'read', file_path: '/a.txt' })
      cb({ type: 'tool_end', tool_name: 'read', file_path: '/a.txt', success: true })
      // Second tool: write
      cb({ type: 'tool_start', tool_name: 'write', file_path: '/b.txt' })
      cb({ type: 'tool_end', tool_name: 'write', file_path: '/b.txt', success: true })

      const task = useTasksStore.getState().tasks[0]
      expect(task.toolActivity).toHaveLength(2)
      expect(task.toolActivity[0].tool_name).toBe('read')
      expect(task.toolActivity[0].success).toBe(true)
      expect(task.toolActivity[1].tool_name).toBe('write')
      expect(task.toolActivity[1].success).toBe(true)
    })

    it('handles tool_end with failure', () => {
      const cb = getEventCallback()
      cb({ type: 'tool_start', tool_name: 'patch', file_path: '/a.txt' })
      cb({ type: 'tool_end', tool_name: 'patch', file_path: '/a.txt', success: false, output: 'old_string not found' })

      const task = useTasksStore.getState().tasks[0]
      expect(task.toolActivity[0].success).toBe(false)
      expect(task.toolActivity[0].output).toBe('old_string not found')
    })

    it('handles error event', () => {
      const cb = getEventCallback()
      cb({ type: 'error', message: 'LLM API error 401' })

      const task = useTasksStore.getState().tasks[0]
      expect(task.error).toBe('LLM API error 401')
    })

    it('handles complete event', () => {
      const cb = getEventCallback()
      cb({ type: 'text', content: 'Done!', partial: false })
      cb({ type: 'complete' })

      const task = useTasksStore.getState().tasks[0]
      expect(task.status).toBe('completed')
      expect(task.completedAt).toBeGreaterThan(0)
    })

    it('handles interrupted event', () => {
      const cb = getEventCallback()
      cb({ type: 'interrupted', reason: 'Too many tool errors. Stopping.' })

      const task = useTasksStore.getState().tasks[0]
      expect(task.status).toBe('interrupted')
      expect(task.error).toBe('Too many tool errors. Stopping.')
      expect(task.completedAt).toBeGreaterThan(0)
    })

    it('ignores events for unknown task ids', () => {
      const cb = getEventCallback()
      // Remove the task so events should be ignored
      useTasksStore.setState({ tasks: [], _listeners: {} })
      // This should not throw
      cb({ type: 'text', content: 'ghost', partial: true })
    })

    it('handles full agent lifecycle', () => {
      const cb = getEventCallback()

      // LLM responds with text
      cb({ type: 'text', content: "I'll read the file.", partial: true })

      // Tool execution
      cb({ type: 'tool_start', tool_name: 'read', file_path: '/src/main.rs' })
      cb({ type: 'tool_end', tool_name: 'read', file_path: '/src/main.rs', success: true, output: 'fn main() {}' })

      // LLM responds again
      cb({ type: 'text', content: "I'll now modify it.", partial: true })

      // Another tool
      cb({ type: 'tool_start', tool_name: 'patch', file_path: '/src/main.rs' })
      cb({ type: 'tool_end', tool_name: 'patch', file_path: '/src/main.rs', success: true })

      // Final response
      cb({ type: 'text', content: "Done! The file has been updated.", partial: false })
      cb({ type: 'complete' })

      const task = useTasksStore.getState().tasks[0]
      expect(task.status).toBe('completed')
      expect(task.text).toBe("Done! The file has been updated.")
      expect(task.toolActivity).toHaveLength(2)
      expect(task.toolActivity[0].tool_name).toBe('read')
      expect(task.toolActivity[1].tool_name).toBe('patch')
    })

    it('handles reasoning followed by tool calls', () => {
      const cb = getEventCallback()

      // Reasoning
      cb({ type: 'reasoning', content: 'I need to understand the codebase. ' })
      cb({ type: 'reasoning', content: 'Let me search for relevant files.' })

      // Tool call
      cb({ type: 'tool_start', tool_name: 'fs_search', description: 'Searching for config files' })
      cb({ type: 'tool_end', tool_name: 'fs_search', success: true, output: 'config.ts:5:export default {}' })

      // Text response
      cb({ type: 'text', content: 'I found the config file.', partial: false })
      cb({ type: 'complete' })

      const task = useTasksStore.getState().tasks[0]
      expect(task.reasoning).toBe('I need to understand the codebase. Let me search for relevant files.')
      expect(task.text).toBe('I found the config file.')
      expect(task.toolActivity).toHaveLength(1)
      expect(task.toolActivity[0].tool_name).toBe('fs_search')
      expect(task.status).toBe('completed')
    })

    it('handles doom loop interruption', () => {
      const cb = getEventCallback()

      // Several tool calls (simulating a loop)
      for (let i = 0; i < 3; i++) {
        cb({ type: 'tool_start', tool_name: 'read', file_path: '/same/file.txt' })
        cb({ type: 'tool_end', tool_name: 'read', file_path: '/same/file.txt', success: true })
      }

      // Interrupted due to doom loop
      cb({ type: 'interrupted', reason: 'Reached maximum turn limit (100).' })

      const task = useTasksStore.getState().tasks[0]
      expect(task.status).toBe('interrupted')
      expect(task.toolActivity).toHaveLength(3)
    })

    it('handles error budget exhaustion', () => {
      const cb = getEventCallback()

      // Tool that keeps failing
      for (let i = 0; i < 5; i++) {
        cb({ type: 'tool_start', tool_name: 'patch', file_path: '/a.txt' })
        cb({ type: 'tool_end', tool_name: 'patch', file_path: '/a.txt', success: false, output: 'not found' })
      }

      cb({ type: 'interrupted', reason: 'Too many tool errors. Stopping.' })

      const task = useTasksStore.getState().tasks[0]
      expect(task.status).toBe('interrupted')
      const failedTools = task.toolActivity.filter(t => t.success === false)
      expect(failedTools).toHaveLength(5)
    })
  })
})
