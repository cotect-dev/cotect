import { describe, it, expect, beforeEach } from 'vitest'
import { useConsoleStore, type LogLevel } from './console'

describe('useConsoleStore', () => {
  beforeEach(() => {
    useConsoleStore.setState({ entries: [], filter: null })
  })

  it('starts with no entries', () => {
    expect(useConsoleStore.getState().entries).toEqual([])
  })

  it('starts with null filter', () => {
    expect(useConsoleStore.getState().filter).toBeNull()
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

    it('records timestamp', () => {
      useConsoleStore.getState().log('info', 'test')
      const entry = useConsoleStore.getState().entries[0]
      expect(entry.timestamp).toBeGreaterThan(0)
      expect(entry.timestamp).toBeLessThanOrEqual(Date.now())
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
      // Fill to capacity
      for (let i = 0; i < 1001; i++) {
        useConsoleStore.getState().log('info', `msg ${i}`)
      }
      const entries = useConsoleStore.getState().entries
      expect(entries).toHaveLength(1000)
      // Newest entry should be the last one added
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

  describe('setFilter', () => {
    it('sets the filter', () => {
      useConsoleStore.getState().setFilter('error')
      expect(useConsoleStore.getState().filter).toBe('error')
    })

    it('clears the filter', () => {
      useConsoleStore.getState().setFilter('error')
      useConsoleStore.getState().setFilter(null)
      expect(useConsoleStore.getState().filter).toBeNull()
    })
  })
})
