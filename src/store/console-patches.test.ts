import { describe, it, expect, beforeEach } from 'vitest'
import { useConsoleStore } from './console'

describe('console monkey-patches and formatArgs', () => {
  beforeEach(() => {
    useConsoleStore.setState({ entries: [], filter: null })
  })

  describe('formatArgs (tested via console wrappers)', () => {
    it('formats a plain string', () => {
      console.log('hello world')
      const entries = useConsoleStore.getState().entries
      const entry = entries.find((e) => e.message === 'hello world')
      expect(entry).toBeDefined()
      expect(entry!.level).toBe('info')
    })

    it('formats multiple string arguments with space separator', () => {
      console.log('hello', 'world')
      const entries = useConsoleStore.getState().entries
      const entry = entries.find((e) => e.message === 'hello world')
      expect(entry).toBeDefined()
    })

    it('formats objects as JSON', () => {
      console.log('data:', { key: 'value' })
      const entries = useConsoleStore.getState().entries
      const entry = entries.find((e) => e.message.includes('"key"'))
      expect(entry).toBeDefined()
      expect(entry!.message).toContain('"value"')
    })

    it('handles circular references gracefully (falls back to String)', () => {
      const obj: Record<string, unknown> = { a: 1 }
      obj.self = obj
      expect(() => console.log('circular:', obj)).not.toThrow()
      const entries = useConsoleStore.getState().entries
      const entry = entries.find((e) => e.message.includes('circular:'))
      expect(entry).toBeDefined()
      expect(entry!.message).toContain('[object Object]')
    })

    it('formats null and undefined correctly', () => {
      console.log('values:', null, undefined)
      const entries = useConsoleStore.getState().entries
      const entry = entries.find((e) => e.message.includes('values:'))
      expect(entry).toBeDefined()
      expect(entry!.message).toContain('null')
      expect(entry!.message).toContain('undefined')
    })

    it('formats numbers via JSON.stringify', () => {
      console.log('count:', 42)
      const entries = useConsoleStore.getState().entries
      const entry = entries.find((e) => e.message.includes('42'))
      expect(entry).toBeDefined()
    })
  })

  describe('console.warn', () => {
    it('logs with warn level', () => {
      console.warn('warning message')
      const entries = useConsoleStore.getState().entries
      const entry = entries.find((e) => e.message === 'warning message')
      expect(entry).toBeDefined()
      expect(entry!.level).toBe('warn')
    })
  })

  describe('console.error', () => {
    it('logs with error level', () => {
      console.error('error message')
      const entries = useConsoleStore.getState().entries
      const entry = entries.find((e) => e.message === 'error message')
      expect(entry).toBeDefined()
      expect(entry!.level).toBe('error')
    })
  })

  describe('console.debug', () => {
    it('logs with debug level', () => {
      console.debug('debug message')
      const entries = useConsoleStore.getState().entries
      const entry = entries.find((e) => e.message === 'debug message')
      expect(entry).toBeDefined()
      expect(entry!.level).toBe('debug')
    })
  })
})
