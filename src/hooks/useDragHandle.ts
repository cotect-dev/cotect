import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

export interface DragContext {
  startX: number
  startY: number
  deltaX: number
  deltaY: number
}

export interface DragHandleOptions {
  /** CSS cursor applied to `document.body` for the duration of the drag. */
  cursor?: 'col-resize' | 'row-resize' | 'grabbing'
  /** Called on every `mousemove` while dragging. */
  onMove: (e: MouseEvent, ctx: DragContext) => void
  /** Called once on `mouseup`, with the final delta. */
  onEnd?: (e: MouseEvent, ctx: DragContext) => void
  /**
   * Called synchronously inside the initial mousedown handler, *before*
   * any global listeners are wired up. Use this to read DOM state or
   * snapshot values that `onMove` needs in its closure.
   *
   * Returning `false` aborts the drag (no listeners attached, no cursor
   * change, no `data-resizing` attribute).
   */
  onStart?: (e: React.MouseEvent) => boolean | void
}

export interface DragHandleResult {
  /** Spread onto the handle element. */
  handleProps: {
    onMouseDown: (e: React.MouseEvent) => void
    ref: React.RefObject<HTMLElement | null>
  }
}

/**
 * Encapsulates the mousedown → document mousemove/mouseup → cleanup
 * lifecycle shared by every drag handle in the app. Calls preventDefault +
 * stopPropagation on mousedown (critical so ReactFlow / dnd-kit don't
 * intercept the gesture), manages body cursor/userSelect, the handle's
 * `data-resizing` attribute, and tear-down on unmount mid-drag.
 */
export function useDragHandle(opts: DragHandleOptions): DragHandleResult {
  const ref = useRef<HTMLElement | null>(null)

  // Latest options stay in a ref so the mousedown callback's identity is
  // stable — callers can recreate closures freely without re-binding the
  // JSX prop. Updated in a layout effect (no ref writes during render).
  const optsRef = useRef(opts)
  useLayoutEffect(() => {
    optsRef.current = opts
  })

  // Non-null when a drag is in flight; the unmount effect runs it.
  const cleanupRef = useRef<(() => void) | null>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const current = optsRef.current
    if (current.onStart && current.onStart(e) === false) return

    const startX = e.clientX
    const startY = e.clientY
    const cursor = current.cursor ?? 'col-resize'
    const handle = ref.current

    handle?.setAttribute('data-resizing', '')
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = cursor
    document.body.style.userSelect = 'none'

    const ctxOf = (ev: MouseEvent): DragContext => ({
      startX,
      startY,
      deltaX: ev.clientX - startX,
      deltaY: ev.clientY - startY,
    })

    const onMove = (ev: MouseEvent) => {
      ev.preventDefault()
      optsRef.current.onMove(ev, ctxOf(ev))
    }

    const cleanup = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      handle?.removeAttribute('data-resizing')
      cleanupRef.current = null
    }

    const onUp = (ev: MouseEvent) => {
      const ctx = ctxOf(ev)
      cleanup()
      optsRef.current.onEnd?.(ev, ctx)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    cleanupRef.current = cleanup
  }, [])

  // Tear down listeners on unmount mid-drag so we don't leak global state.
  useEffect(() => {
    return () => {
      cleanupRef.current?.()
    }
  }, [])

  return {
    handleProps: { onMouseDown, ref },
  }
}
