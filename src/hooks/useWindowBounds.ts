import { useEffect, useRef } from 'react'
import { getPlatform } from '@/services/platform'

export interface WindowBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export function useWindowBounds() {
  const platform = getPlatform()
  const boundsRef = useRef<WindowBounds>({ left: 0, top: 0, right: 0, bottom: 0 })

  useEffect(() => {
    let pos = { x: 0, y: 0 }
    let size = { width: 0, height: 0 }

    const recompute = () => {
      // Physical pixels -> CSS pixels (same coordinate system as clientX/clientY)
      const dpr = window.devicePixelRatio || 1
      boundsRef.current = {
        left: pos.x / dpr,
        top: pos.y / dpr,
        right: (pos.x + size.width) / dpr,
        bottom: (pos.y + size.height) / dpr,
      }
    }

    Promise.all([platform.windows.getPosition(), platform.windows.getSize()])
      .then(([p, s]) => {
        pos = p
        size = s
        recompute()
      })
      .catch((err) => {
        console.warn('[useWindowBounds] initial position/size fetch failed:', err)
      })

    const cleanups: (() => void)[] = []

    platform.windows
      .onMoved((p) => {
        pos = p
        recompute()
      })
      .then((unlisten) => {
        cleanups.push(unlisten)
      })
      .catch((err) => {
        console.warn('[useWindowBounds] onMoved listener attach failed:', err)
      })

    platform.windows
      .onResized((s) => {
        size = s
        recompute()
      })
      .then((unlisten) => {
        cleanups.push(unlisten)
      })
      .catch((err) => {
        console.warn('[useWindowBounds] onResized listener attach failed:', err)
      })

    return () => {
      for (const fn of cleanups) fn()
    }
  }, [platform])

  return boundsRef
}
