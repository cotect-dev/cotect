import { useEffect, useState } from 'react'

export interface CanvasInsets {
  top: number
  left: number
  right: number
  bottom: number
}

const ZERO: CanvasInsets = { top: 0, left: 0, right: 0, bottom: 0 }

/**
 * Measures the four Layout zones (`[data-zone="top|left|right|bottom"]`) and
 * returns their pixel sizes as CSS inset values, so views that don't manage
 * their own viewport math (Graph, Settings) can sit inside the gap left by
 * the TopBar + side panels rather than disappearing behind them. Updates on
 * resize and zone-visibility changes via a single ResizeObserver.
 *
 * Empty zones report 0-width / 0-height (flex-basis: 0) so this hook
 * naturally collapses their inset to 0 — callers don't need to special-case
 * panel visibility.
 */
export function useCanvasInsets(): CanvasInsets {
  const [insets, setInsets] = useState<CanvasInsets>(ZERO)

  useEffect(() => {
    const measure = () => {
      const top = (document.querySelector('[data-zone="top"]') as HTMLElement | null)?.getBoundingClientRect().height ?? 0
      const left = (document.querySelector('[data-zone="left"]') as HTMLElement | null)?.getBoundingClientRect().width ?? 0
      const right = (document.querySelector('[data-zone="right"]') as HTMLElement | null)?.getBoundingClientRect().width ?? 0
      const bottom = (document.querySelector('[data-zone="bottom"]') as HTMLElement | null)?.getBoundingClientRect().height ?? 0
      setInsets((prev) =>
        prev.top === top && prev.left === left && prev.right === right && prev.bottom === bottom
          ? prev
          : { top, left, right, bottom },
      )
    }

    measure()

    const observer = new ResizeObserver(measure)
    const watch = (selector: string) => {
      const el = document.querySelector(selector) as HTMLElement | null
      if (el) observer.observe(el)
    }
    watch('[data-zone="top"]')
    watch('[data-zone="left"]')
    watch('[data-zone="right"]')
    watch('[data-zone="bottom"]')

    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  return insets
}
