import { useEffect, useRef } from 'react'
import { getPlatform } from '@/services/platform'

export interface WindowBounds {
  left: number
  top: number
  right: number
  bottom: number
}

const POLL_INTERVAL = 500

export function useWindowBounds() {
  const platform = getPlatform()
  const boundsRef = useRef<WindowBounds>({ left: 0, top: 0, right: 0, bottom: 0 })

  useEffect(() => {
    const update = async () => {
      const pos = await platform.windows.getPosition()
      const size = await platform.windows.getSize()
      // Convert physical pixels to CSS pixels so bounds are in the same
      // coordinate system as clientX/clientY and getBoundingClientRect().
      // This is critical for multi-monitor setups with mixed DPI scaling.
      const dpr = window.devicePixelRatio || 1
      boundsRef.current = {
        left: pos.x / dpr,
        top: pos.y / dpr,
        right: (pos.x + size.width) / dpr,
        bottom: (pos.y + size.height) / dpr,
      }
    }
    update()
    const timer = setInterval(update, POLL_INTERVAL)
    return () => clearInterval(timer)
  }, [platform])

  return boundsRef
}
