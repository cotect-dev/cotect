import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDragHandle } from './useDragHandle'

/**
 * Helpers — keep tests honest by mirroring the real DOM events the hook
 * listens for, rather than poking the hook's internals.
 */
function makeMouseDown(opts: { clientX: number; clientY: number }) {
  // React.MouseEvent is structural — we only need preventDefault,
  // stopPropagation, and the two clientX/Y fields.
  const preventDefault = vi.fn()
  const stopPropagation = vi.fn()
  return {
    event: {
      clientX: opts.clientX,
      clientY: opts.clientY,
      preventDefault,
      stopPropagation,
    } as unknown as React.MouseEvent,
    preventDefault,
    stopPropagation,
  }
}

function fireDocMouseEvent(type: 'mousemove' | 'mouseup', clientX: number, clientY: number) {
  // jsdom's MouseEvent constructor accepts clientX/clientY in init dict.
  const ev = new MouseEvent(type, { clientX, clientY, bubbles: true })
  document.dispatchEvent(ev)
}

describe('useDragHandle', () => {
  beforeEach(() => {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  })

  it('preventDefault + stopPropagation on the initial mousedown', () => {
    const { result } = renderHook(() =>
      useDragHandle({ onMove: vi.fn() }),
    )
    const { event, preventDefault, stopPropagation } = makeMouseDown({ clientX: 10, clientY: 20 })
    act(() => result.current.handleProps.onMouseDown(event))
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(stopPropagation).toHaveBeenCalledTimes(1)
  })

  it('attaches mousemove/mouseup listeners on mousedown and invokes onMove with delta', () => {
    const onMove = vi.fn()
    const { result } = renderHook(() => useDragHandle({ onMove }))
    const { event } = makeMouseDown({ clientX: 100, clientY: 200 })
    act(() => result.current.handleProps.onMouseDown(event))

    act(() => fireDocMouseEvent('mousemove', 130, 215))

    expect(onMove).toHaveBeenCalledTimes(1)
    const [, ctx] = onMove.mock.calls[0]
    expect(ctx).toMatchObject({ startX: 100, startY: 200, deltaX: 30, deltaY: 15 })
  })

  it('invokes onEnd on mouseup with final delta and detaches listeners', () => {
    const onMove = vi.fn()
    const onEnd = vi.fn()
    const { result } = renderHook(() => useDragHandle({ onMove, onEnd }))
    const { event } = makeMouseDown({ clientX: 0, clientY: 0 })
    act(() => result.current.handleProps.onMouseDown(event))

    act(() => fireDocMouseEvent('mousemove', 5, 7))
    act(() => fireDocMouseEvent('mouseup', 12, 9))

    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd.mock.calls[0][1]).toMatchObject({ startX: 0, startY: 0, deltaX: 12, deltaY: 9 })

    // After mouseup, further document events should NOT reach onMove.
    onMove.mockClear()
    act(() => fireDocMouseEvent('mousemove', 50, 50))
    expect(onMove).not.toHaveBeenCalled()
  })

  it('sets document.body.cursor + userSelect on mousedown and restores on mouseup', () => {
    const { result } = renderHook(() =>
      useDragHandle({ cursor: 'row-resize', onMove: vi.fn() }),
    )
    const { event } = makeMouseDown({ clientX: 0, clientY: 0 })
    act(() => result.current.handleProps.onMouseDown(event))

    expect(document.body.style.cursor).toBe('row-resize')
    expect(document.body.style.userSelect).toBe('none')

    act(() => fireDocMouseEvent('mouseup', 0, 0))

    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })

  it('defaults to col-resize cursor when none specified', () => {
    const { result } = renderHook(() => useDragHandle({ onMove: vi.fn() }))
    const { event } = makeMouseDown({ clientX: 0, clientY: 0 })
    act(() => result.current.handleProps.onMouseDown(event))
    expect(document.body.style.cursor).toBe('col-resize')
    act(() => fireDocMouseEvent('mouseup', 0, 0))
  })

  it('sets data-resizing on the handle ref during the drag and removes on mouseup', () => {
    const { result } = renderHook(() => useDragHandle({ onMove: vi.fn() }))
    // Attach a real DOM element to the hook's ref so the attribute lands somewhere.
    const handle = document.createElement('div')
    document.body.appendChild(handle)
    ;(result.current.handleProps.ref as React.MutableRefObject<HTMLElement | null>).current = handle

    const { event } = makeMouseDown({ clientX: 0, clientY: 0 })
    act(() => result.current.handleProps.onMouseDown(event))
    expect(handle.hasAttribute('data-resizing')).toBe(true)

    act(() => fireDocMouseEvent('mouseup', 0, 0))
    expect(handle.hasAttribute('data-resizing')).toBe(false)

    document.body.removeChild(handle)
  })

  it('detaches listeners and resets cursor when component unmounts mid-drag', () => {
    const onMove = vi.fn()
    const onEnd = vi.fn()
    const { result, unmount } = renderHook(() => useDragHandle({ onMove, onEnd }))
    const handle = document.createElement('div')
    document.body.appendChild(handle)
    ;(result.current.handleProps.ref as React.MutableRefObject<HTMLElement | null>).current = handle

    const { event } = makeMouseDown({ clientX: 0, clientY: 0 })
    act(() => result.current.handleProps.onMouseDown(event))

    expect(document.body.style.cursor).toBe('col-resize')
    expect(handle.hasAttribute('data-resizing')).toBe(true)

    act(() => unmount())

    // Cursor + userSelect restored, attribute removed, listeners detached.
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    expect(handle.hasAttribute('data-resizing')).toBe(false)

    onMove.mockClear()
    act(() => fireDocMouseEvent('mousemove', 100, 100))
    expect(onMove).not.toHaveBeenCalled()

    // onEnd should NOT have fired — unmount is not a successful drag-end.
    expect(onEnd).not.toHaveBeenCalled()

    document.body.removeChild(handle)
  })

  it('aborts the drag when onStart returns false', () => {
    const onMove = vi.fn()
    const onStart = vi.fn(() => false as const)
    const { result } = renderHook(() => useDragHandle({ onMove, onStart }))

    const { event } = makeMouseDown({ clientX: 0, clientY: 0 })
    act(() => result.current.handleProps.onMouseDown(event))

    expect(onStart).toHaveBeenCalledTimes(1)
    expect(document.body.style.cursor).toBe('')

    act(() => fireDocMouseEvent('mousemove', 50, 50))
    expect(onMove).not.toHaveBeenCalled()
  })
})
