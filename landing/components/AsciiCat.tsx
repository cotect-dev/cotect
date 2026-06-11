import { useEffect, useRef } from 'react'
import iconUrl from '../../public/icon.svg'

// The alien cat from the logo rendered as ASCII art on a canvas: the icon's
// alpha channel is sampled into a character grid once, drawn to a persistent
// layer, then kept alive by a slow matrix-style churn of glyphs and a scanning
// shimmer. Hovering opens an x-ray window that dims the surface and reveals
// the figure's skeleton: a thinned medial axis dressed up with ribs,
// vertebra ticks, and eye sockets, all derived from the silhouette itself.
// Moving the cursor fires neuron-like lightning along the bones.

const RENDER_SIZE = 480
const CELL = 7
const FPS = 24
// Glyph churn rate: cells re-rolled per frame. 3 at 24fps over ~1800 cells
// turns the whole figure over in roughly 25 seconds.
const MUTATIONS_PER_FRAME = 3
// Radius of the hover x-ray window, in render coordinates.
const XRAY_RADIUS = 92
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

// Precomputed x-ray anatomy, in render coordinates. Each piece carries a
// midpoint so the hover window can brighten it by distance to the cursor.
interface BoneStroke {
  x1: number
  y1: number
  x2: number
  y2: number
  mx: number
  my: number
  w: number
}

interface RibStroke {
  x1: number
  y1: number
  cx: number
  cy: number
  x2: number
  y2: number
  mx: number
  my: number
}

interface SocketRing {
  x: number
  y: number
  r: number
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
    // Skeleton graph (cells on the medial axis plus adjacency for bolt
    // walks) and the precomputed anatomy drawn inside the x-ray window.
    let skelCells: Cell[] = []
    const skelAdj = new Map<Cell, Cell[]>()
    let boneStrokes: BoneStroke[] = []
    let contourStrokes: BoneStroke[] = []
    let ribStrokes: RibStroke[] = []
    let socketRings: SocketRing[] = []
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

        // The anatomy inside the window, brighter near the center: a faint
        // body contour, thickness-weighted bones, ribs and vertebra ticks,
        // eye-socket rings, and joint markers where bones meet.
        ctx.lineCap = 'round'
        ctx.lineWidth = 0.7
        for (const s of contourStrokes) {
          const d = Math.hypot(s.mx - pointer.x, s.my - pointer.y)
          if (d > XRAY_RADIUS) continue
          const strength = 1 - d / XRAY_RADIUS
          ctx.strokeStyle = `rgba(220, 252, 231, ${0.04 + strength * 0.16})`
          ctx.beginPath()
          ctx.moveTo(s.x1, s.y1)
          ctx.lineTo(s.x2, s.y2)
          ctx.stroke()
        }
        ctx.lineWidth = 0.8
        for (const s of ribStrokes) {
          const d = Math.hypot(s.mx - pointer.x, s.my - pointer.y)
          if (d > XRAY_RADIUS) continue
          const strength = 1 - d / XRAY_RADIUS
          ctx.strokeStyle = `rgba(220, 252, 231, ${0.06 + strength * 0.32})`
          ctx.beginPath()
          ctx.moveTo(s.x1, s.y1)
          ctx.quadraticCurveTo(s.cx, s.cy, s.x2, s.y2)
          ctx.stroke()
        }
        for (const s of boneStrokes) {
          const d = Math.hypot(s.mx - pointer.x, s.my - pointer.y)
          if (d > XRAY_RADIUS) continue
          const strength = 1 - d / XRAY_RADIUS
          ctx.strokeStyle = `rgba(226, 252, 236, ${0.12 + strength * 0.5})`
          ctx.lineWidth = s.w
          ctx.beginPath()
          ctx.moveTo(s.x1, s.y1)
          ctx.lineTo(s.x2, s.y2)
          ctx.stroke()
        }
        ctx.lineWidth = 1.1
        for (const ring of socketRings) {
          const d = Math.hypot(ring.x - pointer.x, ring.y - pointer.y)
          if (d > XRAY_RADIUS + ring.r) continue
          const strength = Math.max(0, 1 - d / XRAY_RADIUS)
          ctx.strokeStyle = `rgba(226, 252, 236, ${0.1 + strength * 0.5})`
          ctx.beginPath()
          ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2)
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
      const skelEdges: Array<[Cell, Cell]> = []
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

      // Local thickness: BFS distance to the nearest empty cell. Holes count
      // as empty, so the eye sockets thin the skull region correctly.
      const distGrid: number[][] = Array.from({ length: dim }, () => new Array(dim).fill(-1))
      const bfs: Array<[number, number]> = []
      for (let gy = 0; gy < dim; gy++) {
        for (let gx = 0; gx < dim; gx++) {
          if (!occ[gy][gx]) {
            distGrid[gy][gx] = 0
            bfs.push([gx, gy])
          }
        }
      }
      for (let qi = 0; qi < bfs.length; qi++) {
        const [gx, gy] = bfs[qi]
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = gx + dx
            const ny = gy + dy
            if (nx < 0 || nx >= dim || ny < 0 || ny >= dim || distGrid[ny][nx] !== -1) continue
            distGrid[ny][nx] = distGrid[gy][gx] + 1
            bfs.push([nx, ny])
          }
        }
      }

      const half = CELL / 2
      // Bones weighted by local thickness, so the spine reads heavier than a
      // whisker bone.
      boneStrokes = skelEdges.map(([a, b]) => {
        const th = Math.max(distGrid[a.y / CELL][a.x / CELL], distGrid[b.y / CELL][b.x / CELL])
        return {
          x1: a.x + half,
          y1: a.y + half,
          x2: b.x + half,
          y2: b.y + half,
          mx: (a.x + b.x) / 2 + half,
          my: (a.y + b.y) / 2 + half,
          w: Math.min(2.4, 0.8 + th * 0.16),
        }
      })

      // Body contour: occupied cells touching the outside, chained into a
      // faint outline so the window reads like a radiograph, not floating
      // lines.
      const outside: boolean[][] = Array.from({ length: dim }, () => new Array(dim).fill(false))
      const flood: Array<[number, number]> = []
      for (let i = 0; i < dim; i++) {
        for (const [gx, gy] of [
          [i, 0],
          [i, dim - 1],
          [0, i],
          [dim - 1, i],
        ]) {
          if (!occ[gy][gx] && !outside[gy][gx]) {
            outside[gy][gx] = true
            flood.push([gx, gy])
          }
        }
      }
      for (let qi = 0; qi < flood.length; qi++) {
        const [gx, gy] = flood[qi]
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = gx + dx
          const ny = gy + dy
          if (nx < 0 || nx >= dim || ny < 0 || ny >= dim) continue
          if (occ[ny][nx] || outside[ny][nx]) continue
          outside[ny][nx] = true
          flood.push([nx, ny])
        }
      }
      const isContour = (gx: number, gy: number) =>
        occ[gy][gx] &&
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => {
          const nx = gx + dx
          const ny = gy + dy
          return nx < 0 || nx >= dim || ny < 0 || ny >= dim || outside[ny][nx]
        })
      contourStrokes = []
      for (let gy = 0; gy < dim; gy++) {
        for (let gx = 0; gx < dim; gx++) {
          if (!isContour(gx, gy)) continue
          for (const [dx, dy] of [
            [1, 0],
            [0, 1],
            [1, 1],
            [1, -1],
          ]) {
            const nx = gx + dx
            const ny = gy + dy
            if (nx < 0 || nx >= dim || ny < 0 || ny >= dim || !isContour(nx, ny)) continue
            contourStrokes.push({
              x1: gx * CELL + half,
              y1: gy * CELL + half,
              x2: nx * CELL + half,
              y2: ny * CELL + half,
              mx: ((gx + nx) / 2) * CELL + half,
              my: ((gy + ny) / 2) * CELL + half,
              w: 0.7,
            })
          }
        }
      }

      // Eye sockets: interior holes the flood fill never reached, outlined
      // as rings.
      socketRings = []
      const seen: boolean[][] = Array.from({ length: dim }, () => new Array(dim).fill(false))
      for (let gy = 0; gy < dim; gy++) {
        for (let gx = 0; gx < dim; gx++) {
          if (occ[gy][gx] || outside[gy][gx] || seen[gy][gx]) continue
          const hole: Array<[number, number]> = [[gx, gy]]
          seen[gy][gx] = true
          for (let qi = 0; qi < hole.length; qi++) {
            const [hx, hy] = hole[qi]
            for (const [dx, dy] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ]) {
              const nx = hx + dx
              const ny = hy + dy
              if (nx < 0 || nx >= dim || ny < 0 || ny >= dim) continue
              if (occ[ny][nx] || outside[ny][nx] || seen[ny][nx]) continue
              seen[ny][nx] = true
              hole.push([nx, ny])
            }
          }
          if (hole.length < 2) continue
          let sx = 0
          let sy = 0
          for (const [hx, hy] of hole) {
            sx += hx
            sy += hy
          }
          socketRings.push({
            x: (sx / hole.length + 0.5) * CELL,
            y: (sy / hole.length + 0.5) * CELL,
            r: (Math.sqrt(hole.length / Math.PI) + 0.7) * CELL,
          })
        }
      }

      // Ribs and vertebrae: strokes perpendicular to the local bone
      // direction, spaced so adjacent skeleton cells never both carry one.
      // Wide regions (the torso) get curved ribs reaching toward the
      // silhouette edge; narrow ones (tail, legs, whiskers) get short
      // vertebra ticks. The skull keeps ribs out via the socket holes, which
      // cap the local thickness there.
      ribStrokes = []
      const blocked = new Set<Cell>()
      for (const c of skelCells) {
        if (blocked.has(c)) continue
        const neighbors = skelAdj.get(c) ?? []
        if (neighbors.length === 0 || neighbors.length > 2) continue
        const gx = c.x / CELL
        const gy = c.y / CELL
        const th = distGrid[gy][gx]
        if (th < 2) continue
        const ax = neighbors.length === 2 ? neighbors[1].x - neighbors[0].x : c.x - neighbors[0].x
        const ay = neighbors.length === 2 ? neighbors[1].y - neighbors[0].y : c.y - neighbors[0].y
        const alen = Math.hypot(ax, ay) || 1
        const px = -ay / alen
        const py = ax / alen
        const x0 = c.x + half
        const y0 = c.y + half
        const isRib = th >= 4
        const reach = isRib ? Math.min(th - 1, 8) * CELL * 0.8 : CELL * 0.9
        // Ribs bow along the bone direction, like a ribcage sweeping back.
        const bend = isRib ? reach * 0.35 : 0
        for (const s of [1, -1]) {
          const ex = x0 + px * reach * s
          const ey = y0 + py * reach * s
          const bx = (x0 + ex) / 2 + (ax / alen) * bend
          const by = (y0 + ey) / 2 + (ay / alen) * bend
          ribStrokes.push({
            x1: x0,
            y1: y0,
            cx: bx,
            cy: by,
            x2: ex,
            y2: ey,
            mx: (x0 + 2 * bx + ex) / 4,
            my: (y0 + 2 * by + ey) / 4,
          })
        }
        for (const n of neighbors) blocked.add(n)
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
