import { useEffect, useRef } from 'react'
import iconUrl from '../../public/icon.svg'

// The alien cat from the logo rendered as ASCII art on a canvas: the icon's
// alpha channel is sampled into a character grid once, drawn to a persistent
// layer, then kept alive by a slow matrix-style churn of glyphs and a scanning
// shimmer. Hovering opens an x-ray window that dims the surface and reveals
// the figure's skeleton (a thinned medial axis of the same grid); moving the
// cursor fires neuron-like lightning along the bones.

const RENDER_SIZE = 480
const CELL = 7
const FPS = 24
// Glyph churn rate: cells re-rolled per frame. 3 at 24fps over ~1800 cells
// turns the whole figure over in roughly 25 seconds.
const MUTATIONS_PER_FRAME = 3
// Radius of the hover x-ray window, in render coordinates.
const XRAY_RADIUS = 78
// Bolt pacing: arcs fire only while the cursor travels (SPAWN_MOVE_PX of
// accumulated movement per strike), never more often than BOLT_SPAWN_MS, so
// a parked cursor just holds the x-ray open without looping strikes.
const BOLT_SPAWN_MS = 140
const MAX_BOLTS = 6
const SPAWN_MOVE_PX = 6

// Glyph pools by intensity band; a random pick within the band keeps the
// shading readable while the texture stays varied and code-flavored.
const LIGHT = "·:;,'^~"
const MID = '=+<>/\\()[]?!'
const DENSE = '#%@&$8{}*'

function glyphFor(intensity: number): string {
  const pool = intensity > 0.75 ? DENSE : intensity > 0.45 ? MID : LIGHT
  return pool[Math.floor(Math.random() * pool.length)]
}

function baseFill(intensity: number): string {
  return `rgba(134, 239, 172, ${0.12 + intensity * 0.38})`
}

interface Cell {
  x: number
  y: number
  char: string
  intensity: number
}

// One neural arc: a jagged path of skeleton cells lit in sequence, then fading.
interface Bolt {
  points: Cell[]
  born: number
  life: number
}

function sampleCells(img: HTMLImageElement): Cell[] {
  const off = document.createElement('canvas')
  off.width = RENDER_SIZE
  off.height = RENDER_SIZE
  const ctx = off.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.drawImage(img, 0, 0, RENDER_SIZE, RENDER_SIZE)
  const data = ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE).data
  const cells: Cell[] = []
  for (let y = 0; y < RENDER_SIZE; y += CELL) {
    for (let x = 0; x < RENDER_SIZE; x += CELL) {
      const px = Math.min(RENDER_SIZE - 1, x + Math.floor(CELL / 2))
      const py = Math.min(RENDER_SIZE - 1, y + Math.floor(CELL / 2))
      const idx = (py * RENDER_SIZE + px) * 4
      // White body reads at full luminance, the gray whiskers dimmer; fold
      // both into one intensity so the pools shade them differently.
      const intensity = (data[idx + 3] / 255) * (data[idx] / 255)
      if (intensity > 0.18) {
        cells.push({ x, y, char: glyphFor(intensity), intensity })
      }
    }
  }
  return cells
}

// Zhang-Suen thinning: erodes the occupied grid down to its one-cell-wide
// medial axis, which reads as the figure's skeleton.
function skeletonize(occ: boolean[][], dim: number): boolean[][] {
  const img = occ.map((row) => row.slice())
  const at = (x: number, y: number) => (x >= 0 && x < dim && y >= 0 && y < dim && img[y][x] ? 1 : 0)
  let changed = true
  while (changed) {
    changed = false
    for (let pass = 0; pass < 2; pass++) {
      const del: Array<[number, number]> = []
      for (let y = 0; y < dim; y++) {
        for (let x = 0; x < dim; x++) {
          if (!img[y][x]) continue
          // Neighbors clockwise from north: p2..p9.
          const p = [
            at(x, y - 1),
            at(x + 1, y - 1),
            at(x + 1, y),
            at(x + 1, y + 1),
            at(x, y + 1),
            at(x - 1, y + 1),
            at(x - 1, y),
            at(x - 1, y - 1),
          ]
          const b = p.reduce((acc, v) => acc + v, 0)
          if (b < 2 || b > 6) continue
          let a = 0
          for (let i = 0; i < 8; i++) if (p[i] === 0 && p[(i + 1) % 8] === 1) a++
          if (a !== 1) continue
          if (pass === 0) {
            if (p[0] * p[2] * p[4] !== 0 || p[2] * p[4] * p[6] !== 0) continue
          } else {
            if (p[0] * p[2] * p[6] !== 0 || p[0] * p[4] * p[6] !== 0) continue
          }
          del.push([x, y])
        }
      }
      for (const [x, y] of del) img[y][x] = false
      if (del.length) changed = true
    }
  }
  return img
}

function buildLayer(cells: Cell[]): {
  layer: HTMLCanvasElement
  lctx: CanvasRenderingContext2D | null
} {
  const layer = document.createElement('canvas')
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  layer.width = RENDER_SIZE * dpr
  layer.height = RENDER_SIZE * dpr
  const lctx = layer.getContext('2d')
  if (!lctx) return { layer, lctx }
  lctx.scale(dpr, dpr)
  lctx.font = `${CELL + 1}px monospace`
  lctx.textBaseline = 'top'
  for (const c of cells) {
    lctx.fillStyle = baseFill(c.intensity)
    lctx.fillText(c.char, c.x, c.y)
  }
  return { layer, lctx }
}

export function AsciiCat({ className = '' }: { className?: string }) {
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
    // Guards the async img.onload: under StrictMode the cleanup runs before
    // the image loads, and an unguarded onload would start an orphan RAF
    // loop fighting the remounted one (visible as rapid glyph flicker).
    let disposed = false
    let cells: Cell[] = []
    let staticLayer: HTMLCanvasElement | null = null
    let layerCtx: CanvasRenderingContext2D | null = null
    // Pointer position in canvas coordinates; null while the cursor is away.
    let pointer: { x: number; y: number } | null = null
    // Skeleton graph: cells on the medial axis, their adjacency for bolt
    // walks, and a deduped edge list for drawing the bones.
    let skelCells: Cell[] = []
    const skelAdj = new Map<Cell, Cell[]>()
    let skelEdges: Array<[Cell, Cell]> = []
    let bolts: Bolt[] = []
    let lastSpawn = 0
    let movedSinceSpawn = 0

    // Non-backtracking random walk along the skeleton, so arcs trace the
    // bones instead of wandering the surface.
    const walkSkeleton = (from: Cell, steps: number): Cell[] => {
      const points = [from]
      let prev: Cell | null = null
      let cur = from
      for (let i = 0; i < steps; i++) {
        const options = (skelAdj.get(cur) ?? []).filter((n) => n !== prev)
        if (!options.length) break
        const next = options[Math.floor(Math.random() * options.length)]
        points.push(next)
        prev = cur
        cur = next
      }
      return points
    }

    const spawnBolt = (t: number) => {
      if (!pointer) return
      let origin: Cell | null = null
      let best = XRAY_RADIUS
      for (const c of skelCells) {
        const d = Math.hypot(c.x - pointer.x, c.y - pointer.y)
        if (d < best) {
          best = d
          origin = c
        }
      }
      if (!origin) return
      const main = walkSkeleton(origin, 8 + Math.floor(Math.random() * 10))
      if (main.length < 3) return
      bolts.push({ points: main, born: t, life: 420 + Math.random() * 260 })
      // Occasional fork off the main arc, like a branching dendrite.
      if (main.length > 4 && Math.random() < 0.4) {
        const mid = main[1 + Math.floor(Math.random() * (main.length - 2))]
        const branch = walkSkeleton(mid, 4 + Math.floor(Math.random() * 5))
        if (branch.length > 2)
          bolts.push({ points: branch, born: t, life: 320 + Math.random() * 180 })
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * RENDER_SIZE
      const y = ((e.clientY - rect.top) / rect.height) * RENDER_SIZE
      const next =
        x > -XRAY_RADIUS &&
        x < RENDER_SIZE + XRAY_RADIUS &&
        y > -XRAY_RADIUS &&
        y < RENDER_SIZE + XRAY_RADIUS
          ? { x, y }
          : null
      if (pointer && next) {
        movedSinceSpawn += Math.hypot(next.x - pointer.x, next.y - pointer.y)
      }
      pointer = next
    }
    window.addEventListener('pointermove', onPointerMove)

    // Matrix churn: re-roll a few random cells per frame in place on the
    // persistent layer, so letters keep slowly changing across the figure.
    const mutate = () => {
      if (!layerCtx) return
      for (let k = 0; k < MUTATIONS_PER_FRAME; k++) {
        const c = cells[Math.floor(Math.random() * cells.length)]
        if (!c) continue
        c.char = glyphFor(c.intensity)
        layerCtx.clearRect(c.x - 1, c.y - 1, CELL + 2, CELL + 2)
        layerCtx.fillStyle = baseFill(c.intensity)
        layerCtx.fillText(c.char, c.x, c.y)
      }
    }

    const draw = (t: number) => {
      if (!staticLayer) return
      ctx.clearRect(0, 0, RENDER_SIZE, RENDER_SIZE)
      ctx.drawImage(staticLayer, 0, 0, RENDER_SIZE, RENDER_SIZE)
      if (reduceMotion) return

      ctx.font = `${CELL + 1}px monospace`
      ctx.textBaseline = 'top'
      const half = CELL / 2

      // X-ray window: fade the ASCII surface around the cursor so the
      // skeleton underneath shows through.
      if (pointer) {
        ctx.save()
        ctx.globalCompositeOperation = 'destination-out'
        const hole = ctx.createRadialGradient(
          pointer.x,
          pointer.y,
          0,
          pointer.x,
          pointer.y,
          XRAY_RADIUS,
        )
        hole.addColorStop(0, 'rgba(0, 0, 0, 0.8)')
        hole.addColorStop(1, 'rgba(0, 0, 0, 0)')
        ctx.fillStyle = hole
        ctx.beginPath()
        ctx.arc(pointer.x, pointer.y, XRAY_RADIUS, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()

        // Bones: skeleton edges inside the window, brighter near the center,
        // with joint markers where bones meet.
        ctx.lineWidth = 1
        for (const [a, b] of skelEdges) {
          const d = Math.hypot((a.x + b.x) / 2 - pointer.x, (a.y + b.y) / 2 - pointer.y)
          if (d > XRAY_RADIUS) continue
          const strength = 1 - d / XRAY_RADIUS
          ctx.strokeStyle = `rgba(220, 252, 231, ${0.1 + strength * 0.45})`
          ctx.beginPath()
          ctx.moveTo(a.x + half, a.y + half)
          ctx.lineTo(b.x + half, b.y + half)
          ctx.stroke()
        }
        for (const c of skelCells) {
          if ((skelAdj.get(c)?.length ?? 0) < 3) continue
          const d = Math.hypot(c.x - pointer.x, c.y - pointer.y)
          if (d > XRAY_RADIUS) continue
          const strength = 1 - d / XRAY_RADIUS
          ctx.fillStyle = `rgba(220, 252, 231, ${0.2 + strength * 0.6})`
          ctx.fillRect(c.x + half - 1, c.y + half - 1, 2.5, 2.5)
        }
      }

      // Lightning: arcs fire along the skeleton while the cursor moves, then
      // linger and fade even after it stops or leaves.
      if (
        pointer &&
        movedSinceSpawn > SPAWN_MOVE_PX &&
        t - lastSpawn > BOLT_SPAWN_MS &&
        bolts.length < MAX_BOLTS
      ) {
        lastSpawn = t
        movedSinceSpawn = 0
        spawnBolt(t)
      }
      if (bolts.length) {
        bolts = bolts.filter((b) => t - b.born < b.life)
        ctx.lineJoin = 'round'
        for (const b of bolts) {
          const age = (t - b.born) / b.life
          const fade = (1 - age) ** 1.6
          // The signal travels the path over the first 35% of the bolt's
          // life, then the whole arc fades together.
          const head = Math.max(
            1,
            Math.min(b.points.length - 1, Math.ceil((age / 0.35) * (b.points.length - 1))),
          )
          ctx.beginPath()
          ctx.moveTo(b.points[0].x + half, b.points[0].y + half)
          for (let i = 1; i <= head; i++) {
            ctx.lineTo(b.points[i].x + half, b.points[i].y + half)
          }
          ctx.strokeStyle = `rgba(187, 247, 208, ${fade * 0.2})`
          ctx.lineWidth = 2.4
          ctx.stroke()
          ctx.strokeStyle = `rgba(220, 252, 231, ${fade * 0.65})`
          ctx.lineWidth = 0.9
          ctx.stroke()
          const headCell = b.points[head]
          if (age < 0.4) {
            ctx.fillStyle = `rgba(240, 253, 244, ${fade * 0.95})`
            ctx.fillText(headCell.char, headCell.x, headCell.y)
          }
        }
      }

      // Scanning shimmer: a soft light band sweeping down the glyphs.
      const bandY = (((t / 1000) * 46) % (RENDER_SIZE + 240)) - 120
      ctx.save()
      ctx.globalCompositeOperation = 'source-atop'
      const grad = ctx.createLinearGradient(0, bandY - 90, 0, bandY + 90)
      grad.addColorStop(0, 'rgba(187, 247, 208, 0)')
      grad.addColorStop(0.5, 'rgba(187, 247, 208, 0.28)')
      grad.addColorStop(1, 'rgba(187, 247, 208, 0)')
      ctx.fillStyle = grad
      ctx.fillRect(0, bandY - 90, RENDER_SIZE, 180)
      ctx.restore()
    }

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      if (!visible || t - last < 1000 / FPS) return
      last = t
      mutate()
      draw(t)
    }

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
    })
    io.observe(canvas)

    const img = new Image()
    img.src = iconUrl
    img.onload = () => {
      if (disposed) return
      cells = sampleCells(img)
      const grid = new Map<string, Cell>()
      for (const c of cells) grid.set(`${c.x / CELL},${c.y / CELL}`, c)

      const dim = Math.ceil(RENDER_SIZE / CELL)
      const occ: boolean[][] = Array.from({ length: dim }, () => new Array(dim).fill(false))
      for (const c of cells) occ[c.y / CELL][c.x / CELL] = true
      const skel = skeletonize(occ, dim)
      const skelByKey = new Map<string, Cell>()
      skelCells = []
      for (let gy = 0; gy < dim; gy++) {
        for (let gx = 0; gx < dim; gx++) {
          if (!skel[gy][gx]) continue
          const c = grid.get(`${gx},${gy}`)
          if (!c) continue
          skelByKey.set(`${gx},${gy}`, c)
          skelCells.push(c)
        }
      }
      skelEdges = []
      for (const c of skelCells) {
        const gx = c.x / CELL
        const gy = c.y / CELL
        const neighbors: Cell[] = []
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue
            const n = skelByKey.get(`${gx + dx},${gy + dy}`)
            if (!n) continue
            neighbors.push(n)
            if (dy > 0 || (dy === 0 && dx > 0)) skelEdges.push([c, n])
          }
        }
        skelAdj.set(c, neighbors)
      }

      const built = buildLayer(cells)
      staticLayer = built.layer
      layerCtx = built.lctx
      if (reduceMotion) {
        draw(0)
      } else {
        raf = requestAnimationFrame(loop)
      }
    }

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      io.disconnect()
      window.removeEventListener('pointermove', onPointerMove)
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
