import { useEffect, useRef } from 'react'
import iconUrl from '../../public/icon.svg'

// The alien cat from the logo, rebuilt as a drifting node graph: points are
// sampled from the icon's silhouette at mount, joined to their nearest
// neighbors, and animated on a small canvas. Same idea as the app's import
// graph, so the mascot and the product share a visual language.

const RENDER_SIZE = 480
const GRID_STEP = 9
const JITTER = 4
const NEIGHBORS = 3
const DRIFT_AMP = 3.2
const FPS = 30

interface Pt {
  hx: number
  hy: number
  phase: number
  speed: number
  r: number
}

function samplePoints(img: HTMLImageElement): Pt[] {
  const off = document.createElement('canvas')
  off.width = RENDER_SIZE
  off.height = RENDER_SIZE
  const ctx = off.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.drawImage(img, 0, 0, RENDER_SIZE, RENDER_SIZE)
  const data = ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE).data
  const pts: Pt[] = []
  for (let y = GRID_STEP / 2; y < RENDER_SIZE; y += GRID_STEP) {
    for (let x = GRID_STEP / 2; x < RENDER_SIZE; x += GRID_STEP) {
      const sx = Math.min(
        RENDER_SIZE - 1,
        Math.max(0, Math.round(x + (Math.random() * 2 - 1) * JITTER)),
      )
      const sy = Math.min(
        RENDER_SIZE - 1,
        Math.max(0, Math.round(y + (Math.random() * 2 - 1) * JITTER)),
      )
      if (data[(sy * RENDER_SIZE + sx) * 4 + 3] > 100) {
        pts.push({
          hx: sx,
          hy: sy,
          phase: Math.random() * Math.PI * 2,
          speed: 0.4 + Math.random() * 0.5,
          r: 0.6 + Math.random() * 0.8,
        })
      }
    }
  }
  return pts
}

function buildEdges(pts: Pt[]): Array<[number, number]> {
  const edges: Array<[number, number]> = []
  const seen = new Set<string>()
  for (let i = 0; i < pts.length; i++) {
    const dists = pts
      .map((p, j) => ({ j, d: (p.hx - pts[i].hx) ** 2 + (p.hy - pts[i].hy) ** 2 }))
      .filter(({ j }) => j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, NEIGHBORS)
    for (const { j } of dists) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`
      if (!seen.has(key)) {
        seen.add(key)
        edges.push(i < j ? [i, j] : [j, i])
      }
    }
  }
  return edges
}

export function HeroCatGraph({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = RENDER_SIZE * dpr
    canvas.height = RENDER_SIZE * dpr
    ctx.scale(dpr, dpr)

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let last = 0
    let visible = true
    let pts: Pt[] = []
    let edges: Array<[number, number]> = []
    const pos = { xs: [] as number[], ys: [] as number[] }

    const draw = (t: number) => {
      ctx.clearRect(0, 0, RENDER_SIZE, RENDER_SIZE)
      // Ghost of the icon under the constellation so the silhouette reads;
      // the points and edges give it life.
      ctx.globalAlpha = 0.05
      ctx.drawImage(img, 0, 0, RENDER_SIZE, RENDER_SIZE)
      ctx.globalAlpha = 1
      const time = t / 1000
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]
        pos.xs[i] = reduceMotion ? p.hx : p.hx + Math.sin(time * p.speed + p.phase) * DRIFT_AMP
        pos.ys[i] = reduceMotion
          ? p.hy
          : p.hy + Math.cos(time * p.speed * 0.8 + p.phase) * DRIFT_AMP
      }
      ctx.lineWidth = 1
      for (const [a, b] of edges) {
        const shimmer = reduceMotion ? 0 : Math.sin(time * 0.7 + pts[a].phase + pts[b].phase)
        ctx.strokeStyle = `rgba(74, 222, 128, ${0.1 + 0.05 * shimmer})`
        ctx.beginPath()
        ctx.moveTo(pos.xs[a], pos.ys[a])
        ctx.lineTo(pos.xs[b], pos.ys[b])
        ctx.stroke()
      }
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]
        const pulse = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 1.1 + p.phase)
        ctx.fillStyle = `rgba(187, 247, 208, ${0.25 + 0.3 * pulse})`
        ctx.beginPath()
        ctx.arc(pos.xs[i], pos.ys[i], p.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      if (!visible || t - last < 1000 / FPS) return
      last = t
      draw(t)
    }

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
    })
    io.observe(canvas)

    const img = new Image()
    img.src = iconUrl
    img.onload = () => {
      pts = samplePoints(img)
      edges = buildEdges(pts)
      if (reduceMotion) {
        draw(0)
      } else {
        raf = requestAnimationFrame(loop)
      }
    }

    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{ width: RENDER_SIZE, height: RENDER_SIZE }}
    />
  )
}
