import { useEffect, useRef } from 'react'
import iconUrl from '../../public/icon.svg'

// The alien cat from the logo rendered as ASCII art on a canvas: the icon's
// alpha channel is sampled into a character grid once, drawn to a persistent
// layer, then kept alive by a slow matrix-style churn of glyphs and a scanning
// shimmer. Hovering opens an x-ray window that dims the surface and reveals
// a hand-fitted cat skeleton beneath; moving the cursor fires neuron-like
// lightning along the bones.

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

// One neural arc: a jagged path of skeleton nodes lit in sequence, then fading.
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

// The skeleton itself, hand-fitted to the icon's silhouette on the same
// 69-cell sampling grid using an offline preview tool (the medial axis of
// the shape does not resemble anatomy). The cat sits in profile facing
// left: skull top-left, spine along the back, ribcage closing on a sternum,
// front legs lower-left, pelvis and folded hind leg in the haunch, tail
// rising on the right. Coordinates are grid cells; w is stroke width.
const BONES: Array<{ pts: Array<[number, number]>; w?: number; ticks?: boolean }> = [
  // skull: cranium dome, jaw, cheekbone, two teeth
  {
    pts: [
      [28, 20],
      [27.5, 15],
      [24, 11],
      [18, 9.5],
      [13, 10.5],
      [10, 13],
      [9.5, 14.5],
    ],
    w: 1.7,
  },
  {
    pts: [
      [9.5, 14.5],
      [8.5, 18],
      [9, 20],
      [11, 21.5],
      [16, 22.5],
      [23, 22.5],
      [28, 20],
    ],
    w: 1.4,
  },
  {
    pts: [
      [15.2, 17.8],
      [18, 18.6],
      [20.5, 18.8],
    ],
    w: 1,
  },
  {
    pts: [
      [11.5, 21.5],
      [11.5, 23],
    ],
    w: 1,
  },
  {
    pts: [
      [13.5, 22],
      [13.5, 23.2],
    ],
    w: 1,
  },
  // ear cartilage
  {
    pts: [
      [12, 10.5],
      [11, 4.5],
    ],
    w: 1,
  },
  {
    pts: [
      [18.5, 10],
      [16.5, 3.5],
    ],
    w: 1,
  },
  // cervical vertebrae, then the spine along the back
  {
    pts: [
      [26, 19],
      [28, 22],
      [30, 26],
    ],
    w: 2,
    ticks: true,
  },
  {
    pts: [
      [30, 26],
      [32, 30],
      [34.5, 34],
      [37, 37.5],
      [40, 41],
      [43, 44],
      [46, 47],
      [48, 50],
    ],
    w: 2.2,
    ticks: true,
  },
  // sternum collecting the rib ends
  {
    pts: [
      [17.5, 33.5],
      [18.5, 37],
      [20, 40.5],
      [22, 43.8],
      [24.5, 46.6],
      [27.5, 48.8],
    ],
    w: 1.1,
  },
  // scapula
  {
    pts: [
      [26.5, 30],
      [30, 34],
      [24.5, 34.5],
      [26.5, 30],
    ],
    w: 1.2,
  },
  // front legs, near and far
  {
    pts: [
      [26, 35.5],
      [23, 41.5],
      [21.5, 50],
      [21, 58.5],
      [17.5, 63.5],
    ],
    w: 1.6,
  },
  {
    pts: [
      [27.5, 36.5],
      [25, 42.5],
      [24.5, 51],
      [24, 59],
      [21, 64],
    ],
    w: 1.2,
  },
  // hind leg folded under the haunch: femur, tibia, foot
  {
    pts: [
      [47.5, 51.5],
      [42, 53.5],
      [38.5, 55.5],
    ],
    w: 1.8,
  },
  {
    pts: [
      [38.5, 55.5],
      [42, 59],
      [45.5, 62.5],
    ],
    w: 1.6,
  },
  {
    pts: [
      [45.5, 62.5],
      [40, 63.5],
      [34.5, 64],
    ],
    w: 1.3,
  },
  // tail exiting the rump and rising on the right
  {
    pts: [
      [48.5, 52.5],
      [50.5, 55.5],
      [52.5, 56.8],
      [54, 54.5],
      [54.5, 48],
      [54, 40],
      [54, 33],
      [54.5, 28],
    ],
    w: 1.5,
    ticks: true,
  },
]

const RIBS: Array<{ from: [number, number]; via: [number, number]; to: [number, number] }> = [
  { from: [31.2, 28.8], via: [26.8, 33.6], to: [17.5, 33.5] },
  { from: [33, 31.8], via: [28.2, 36.9], to: [18.5, 37] },
  { from: [35, 35], via: [30, 40.2], to: [20, 40.5] },
  { from: [37, 38], via: [32, 43.4], to: [22, 43.8] },
  { from: [39.5, 41], via: [34.5, 46.3], to: [24.5, 46.6] },
  { from: [42, 43.7], via: [37.2, 48.7], to: [27.5, 48.8] },
]

// Eye socket and pelvis.
const RINGS: Array<{ x: number; y: number; r: number }> = [
  { x: 12.5, y: 16, r: 2.4 },
  { x: 47.5, y: 51, r: 2.6 },
]

// Skull base, spine top, shoulder, elbow, wrist, pelvis, knee, hock, tail base.
const JOINTS: Array<[number, number]> = [
  [26, 19],
  [30, 26],
  [26, 35.5],
  [23, 41.5],
  [21, 58.5],
  [48, 50],
  [38.5, 55.5],
  [45.5, 62.5],
  [48.5, 52.5],
]

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
    // The anatomy drawn inside the x-ray window, plus a node graph sampled
    // along it for the lightning walks.
    let skelNodes: Cell[] = []
    const skelAdj = new Map<Cell, Cell[]>()
    let boneStrokes: BoneStroke[] = []
    let contourStrokes: BoneStroke[] = []
    let ribStrokes: RibStroke[] = []
    let socketRings: SocketRing[] = []
    let jointDots: Array<{ x: number; y: number }> = []
    let bolts: Bolt[] = []
    let lastSpawn = 0
    let movedSinceSpawn = 0

    // Non-backtracking random walk along the skeleton graph, so arcs trace
    // the bones instead of wandering the surface.
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
      for (const c of skelNodes) {
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
        // body contour, bones with vertebra ticks, ribs, socket rings, and
        // joint markers.
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
        ctx.lineWidth = 0.9
        for (const s of ribStrokes) {
          const d = Math.hypot(s.mx - pointer.x, s.my - pointer.y)
          if (d > XRAY_RADIUS) continue
          const strength = 1 - d / XRAY_RADIUS
          ctx.strokeStyle = `rgba(220, 252, 231, ${0.07 + strength * 0.38})`
          ctx.beginPath()
          ctx.moveTo(s.x1, s.y1)
          ctx.quadraticCurveTo(s.cx, s.cy, s.x2, s.y2)
          ctx.stroke()
        }
        for (const s of boneStrokes) {
          const d = Math.hypot(s.mx - pointer.x, s.my - pointer.y)
          if (d > XRAY_RADIUS) continue
          const strength = 1 - d / XRAY_RADIUS
          ctx.strokeStyle = `rgba(226, 252, 236, ${0.12 + strength * 0.55})`
          ctx.lineWidth = s.w
          ctx.beginPath()
          ctx.moveTo(s.x1, s.y1)
          ctx.lineTo(s.x2, s.y2)
          ctx.stroke()
        }
        ctx.lineWidth = 1.2
        for (const ring of socketRings) {
          const d = Math.hypot(ring.x - pointer.x, ring.y - pointer.y)
          if (d > XRAY_RADIUS + ring.r) continue
          const strength = Math.max(0, 1 - d / XRAY_RADIUS)
          ctx.strokeStyle = `rgba(226, 252, 236, ${0.1 + strength * 0.5})`
          ctx.beginPath()
          ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2)
          ctx.stroke()
        }
        for (const j of jointDots) {
          const d = Math.hypot(j.x - pointer.x, j.y - pointer.y)
          if (d > XRAY_RADIUS) continue
          const strength = 1 - d / XRAY_RADIUS
          ctx.fillStyle = `rgba(240, 253, 244, ${0.15 + strength * 0.6})`
          ctx.beginPath()
          ctx.arc(j.x, j.y, 1.6, 0, Math.PI * 2)
          ctx.fill()
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

      const dim = Math.ceil(RENDER_SIZE / CELL)
      const occ: boolean[][] = Array.from({ length: dim }, () => new Array(dim).fill(false))
      for (const c of cells) occ[c.y / CELL][c.x / CELL] = true

      const half = CELL / 2
      const G = (g: number) => g * CELL + half

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
              x1: G(gx),
              y1: G(gy),
              x2: G(nx),
              y2: G(ny),
              mx: G((gx + nx) / 2),
              my: G((gy + ny) / 2),
              w: 0.7,
            })
          }
        }
      }

      // The authored skeleton, scaled to render coordinates.
      boneStrokes = []
      for (const bone of BONES) {
        const w = bone.w ?? 1.4
        for (let i = 1; i < bone.pts.length; i++) {
          const [ax, ay] = bone.pts[i - 1]
          const [bx, by] = bone.pts[i]
          boneStrokes.push({
            x1: G(ax),
            y1: G(ay),
            x2: G(bx),
            y2: G(by),
            mx: G((ax + bx) / 2),
            my: G((ay + by) / 2),
            w,
          })
          if (bone.ticks) {
            // Vertebra ticks perpendicular to the bone.
            const segLen = Math.hypot(bx - ax, by - ay)
            const px = -(by - ay) / segLen
            const py = (bx - ax) / segLen
            const n = Math.max(1, Math.round(segLen / 1.6))
            for (let k = 0; k < n; k++) {
              const tt = (k + 0.5) / n
              const cx = G(ax + (bx - ax) * tt)
              const cy = G(ay + (by - ay) * tt)
              boneStrokes.push({
                x1: cx - px * 3.5,
                y1: cy - py * 3.5,
                x2: cx + px * 3.5,
                y2: cy + py * 3.5,
                mx: cx,
                my: cy,
                w: 0.8,
              })
            }
          }
        }
      }
      ribStrokes = RIBS.map((r) => {
        const x1 = G(r.from[0])
        const y1 = G(r.from[1])
        const cx = G(r.via[0])
        const cy = G(r.via[1])
        const x2 = G(r.to[0])
        const y2 = G(r.to[1])
        return { x1, y1, cx, cy, x2, y2, mx: (x1 + 2 * cx + x2) / 4, my: (y1 + 2 * cy + y2) / 4 }
      })
      socketRings = RINGS.map((r) => ({ x: G(r.x), y: G(r.y), r: r.r * CELL }))
      jointDots = JOINTS.map(([x, y]) => ({ x: G(x), y: G(y) }))

      // Lightning graph: nodes sampled along every bone and rib, chained in
      // order, then cross-linked where chains come close (the joints).
      const chains: Array<Array<[number, number]>> = []
      for (const bone of BONES) {
        const chain: Array<[number, number]> = [[G(bone.pts[0][0]), G(bone.pts[0][1])]]
        for (let i = 1; i < bone.pts.length; i++) {
          const [ax, ay] = bone.pts[i - 1]
          const [bx, by] = bone.pts[i]
          const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 1.4))
          for (let k = 1; k <= n; k++) {
            chain.push([G(ax + ((bx - ax) * k) / n), G(ay + ((by - ay) * k) / n)])
          }
        }
        chains.push(chain)
      }
      for (const r of RIBS) {
        const chain: Array<[number, number]> = []
        for (let k = 0; k <= 8; k++) {
          const tt = k / 8
          const u = 1 - tt
          chain.push([
            u * u * G(r.from[0]) + 2 * u * tt * G(r.via[0]) + tt * tt * G(r.to[0]),
            u * u * G(r.from[1]) + 2 * u * tt * G(r.via[1]) + tt * tt * G(r.to[1]),
          ])
        }
        chains.push(chain)
      }
      skelNodes = []
      const chainNodes: Cell[][] = chains.map((chain) =>
        chain.map(([x, y]) => {
          const node: Cell = { x: x - half, y: y - half, char: glyphFor(0.8), intensity: 0.8 }
          skelNodes.push(node)
          return node
        }),
      )
      const link = (a: Cell, b: Cell) => {
        for (const [from, to] of [
          [a, b],
          [b, a],
        ]) {
          const list = skelAdj.get(from)
          if (list) list.push(to)
          else skelAdj.set(from, [to])
        }
      }
      for (const nodes of chainNodes) {
        for (let i = 1; i < nodes.length; i++) link(nodes[i - 1], nodes[i])
      }
      // Fuse chains at shared joints: endpoints adopt any node from another
      // chain that sits within roughly a cell and a half.
      for (let ci = 0; ci < chainNodes.length; ci++) {
        for (const end of [chainNodes[ci][0], chainNodes[ci][chainNodes[ci].length - 1]]) {
          for (let cj = 0; cj < chainNodes.length; cj++) {
            if (ci === cj) continue
            for (const other of chainNodes[cj]) {
              if (Math.hypot(end.x - other.x, end.y - other.y) < CELL * 1.6) link(end, other)
            }
          }
        }
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
