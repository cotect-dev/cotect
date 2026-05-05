import { describe, it, expect, beforeEach } from 'vitest'
import { useConsoleStore, type LogLevel } from './console'

describe('useConsoleStore', () => {
  beforeEach(() => {
    useConsoleStore.setState({ entries: [], filter: null })
  })

  describe('log', () => {
    it('adds an info entry', () => {
      useConsoleStore.getState().log('info', 'hello')
      const entries = useConsoleStore.getState().entries
      expect(entries).toHaveLength(1)
      expect(entries[0].level).toBe('info')
      expect(entries[0].message).toBe('hello')
    })

    it('adds entries with incrementing ids', () => {
      useConsoleStore.getState().log('info', 'first')
      useConsoleStore.getState().log('warn', 'second')
      const entries = useConsoleStore.getState().entries
      expect(entries).toHaveLength(2)
      expect(entries[0].id).not.toBe(entries[1].id)
    })

    it('supports all log levels', () => {
      const levels: LogLevel[] = ['info', 'warn', 'error', 'debug']
      for (const level of levels) {
        useConsoleStore.getState().log(level, `${level} message`)
      }
      const entries = useConsoleStore.getState().entries
      expect(entries).toHaveLength(4)
      expect(entries.map((e) => e.level)).toEqual(levels)
    })

    it('trims entries at MAX_ENTRIES (1000)', () => {
      for (let i = 0; i < 1001; i++) {
        useConsoleStore.getState().log('info', `msg ${i}`)
      }
      const entries = useConsoleStore.getState().entries
      expect(entries).toHaveLength(1000)
      expect(entries[entries.length - 1].message).toBe('msg 1000')
    })
  })

  describe('clear', () => {
    it('clears all entries', () => {
      useConsoleStore.getState().log('info', 'a')
      useConsoleStore.getState().log('warn', 'b')
      useConsoleStore.getState().clear()
      expect(useConsoleStore.getState().entries).toEqual([])
    })
  })
})
