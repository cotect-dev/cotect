import { useEffect, useRef } from 'react'
import iconUrl from '../../public/icon.svg'

// The alien cat from the logo rendered as ASCII art on a canvas: the icon's
// alpha channel is sampled into a character grid once, drawn to a persistent
// layer, then kept alive by a slow matrix-style churn of glyphs and a scanning
// shimmer. Hovering opens an x-ray window that dims the surface and reveals
// a hand-fitted cat skeleton beneath; moving the cursor fires neuron-like
// lightning along the bones. Append ?skeleton to the URL to display the full
// skeleton without hovering (layout review mode).

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

// The skeleton itself, hand-fitted to the icon's silhouette on the same
// 69-cell sampling grid using an offline preview tool, with every point
// verified to keep a margin from the silhouette edge (2 cells in thick
// regions, centered in thin strips like the tail; the left ear strip is too
// thin to hold a bone at all). The cat sits in profile facing left: skull
// top-left with an angular orbit, spine along the back, egg-shaped ribcage
// closing on a sternum, front legs lower-left, pelvis plate and folded hind
// leg in the haunch, tail rising on the right and tucking behind the haunch
// at its base. Coordinates are grid cells; w is stroke width.
const BONES: Array<{ pts: Array<[number, number]>; w?: number; ticks?: boolean }> = [
  // cranium dome
  {
    pts: [
      [26, 20],
      [25.5, 15.5],
      [23, 12],
      [18, 10.8],
      [13.5, 11.5],
      [11, 13.5],
      [10.5, 15.5],
    ],
    w: 1.7,
  },
  // jaw
  {
    pts: [
      [10.5, 15.5],
      [10, 17.5],
      [11, 19.5],
      [13, 20.8],
      [17, 21.3],
      [22, 21],
      [26, 20],
    ],
    w: 1.4,
  },
  // eye socket as an angular orbit
  {
    pts: [
      [12, 14.8],
      [13.8, 15.6],
      [14.2, 17.4],
      [12.8, 18.3],
      [11.6, 16.8],
      [12, 14.8],
    ],
    w: 1,
  },
  // cheekbone
  {
    pts: [
      [14.5, 18],
      [18, 18.8],
      [20.5, 19],
    ],
    w: 1,
  },
  // right ear cartilage
  {
    pts: [
      [19, 10.5],
      [18, 8],
      [17, 6],
      [16.2, 4.8],
    ],
    w: 1,
  },
  // cervical vertebrae
  {
    pts: [
      [24, 19.5],
      [26, 22.5],
      [28, 26],
    ],
    w: 2,
    ticks: true,
  },
  // spine along the back
  {
    pts: [
      [28, 26],
      [30, 30],
      [32, 34],
      [35, 38],
      [38, 42],
      [41, 45],
      [44, 48],
      [46, 50],
    ],
    w: 2.2,
    ticks: true,
  },
  // sternum collecting the rib ends
  {
    pts: [
      [19, 31],
      [18, 34],
      [18.5, 37.5],
      [20, 41],
      [22, 44],
      [24.5, 46.6],
    ],
    w: 1.1,
  },
  // scapula
  {
    pts: [
      [26, 30],
      [29.5, 33.5],
      [24, 34],
      [26, 30],
    ],
    w: 1.2,
  },
  // front legs, near and far
  {
    pts: [
      [26, 35.5],
      [23, 41.5],
      [20.8, 50],
      [20.2, 58],
      [19.8, 62.8],
    ],
    w: 1.6,
  },
  {
    pts: [
      [27.5, 36.5],
      [24.5, 42.5],
      [23.2, 51],
      [22.8, 58],
      [22.2, 63],
    ],
    w: 1.2,
  },
  // pelvis as an angular plate
  {
    pts: [
      [45, 50.5],
      [47.5, 52],
      [47, 54],
      [44.5, 53.5],
      [45, 50.5],
    ],
    w: 1.4,
  },
  // hind leg folded under the haunch: femur, tibia, foot
  {
    pts: [
      [46, 53],
      [42, 54.5],
      [39, 56],
    ],
    w: 1.8,
  },
  {
    pts: [
      [39, 56],
      [42.5, 59.5],
      [45, 62],
    ],
    w: 1.6,
  },
  {
    pts: [
      [45, 62],
      [40, 63],
      [36, 63.3],
    ],
    w: 1.3,
  },
  // tail: emerges from behind the haunch and rises on the right
  {
    pts: [
      [54, 60],
      [55, 57.5],
      [55.8, 55],
      [56, 52],
      [55.2, 48.5],
      [55, 46.5],
      [54.2, 43],
      [54, 39],
      [54, 34],
      [54.2, 29.5],
    ],
    w: 1.5,
    ticks: true,
  },
]

const RIBS: Array<{ from: [number, number]; via: [number, number]; to: [number, number] }> = [
  { from: [28.3, 27], via: [25, 31.5], to: [19, 31.5] },
  { from: [29.5, 29.5], via: [25.2, 34.5], to: [18.2, 34.5] },
  { from: [31, 32.5], via: [26.3, 37.9], to: [18.7, 38] },
  { from: [33, 35.8], via: [28, 41.2], to: [20.3, 41.3] },
  { from: [35.2, 39], via: [30.2, 44.3], to: [22.3, 44.2] },
  { from: [37.5, 42], via: [32.5, 46.7], to: [24.5, 46.6] },
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
    // Review mode: render the entire skeleton at full strength, no hover
    // needed.
    const showFull = new URLSearchParams(window.location.search).has('skeleton')
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
      if (reduceMotion && !showFull) return

      ctx.font = `${CELL + 1}px monospace`
      ctx.textBaseline = 'top'
      const half = CELL / 2

      // X-ray: in hover mode a soft window around the cursor, in review mode
      // the whole figure.
      if (showFull || pointer) {
        ctx.save()
        ctx.globalCompositeOperation = 'destination-out'
        if (showFull) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.62)'
          ctx.fillRect(0, 0, RENDER_SIZE, RENDER_SIZE)
        } else if (pointer) {
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
        }
        ctx.restore()

        // Brightness by proximity to the cursor; flat in review mode.
        // Negative means outside the window.
        const strengthFor = (mx: number, my: number): number => {
          if (showFull) return 1
          if (!pointer) return -1
          const d = Math.hypot(mx - pointer.x, my - pointer.y)
          return d > XRAY_RADIUS ? -1 : 1 - d / XRAY_RADIUS
        }

        // The anatomy: a faint body contour, then bones with vertebra ticks
        // and the ribs.
        ctx.lineCap = 'round'
        ctx.lineWidth = 0.7
        for (const s of contourStrokes) {
          const strength = strengthFor(s.mx, s.my)
          if (strength < 0) continue
          ctx.strokeStyle = `rgba(220, 252, 231, ${0.04 + strength * 0.16})`
          ctx.beginPath()
          ctx.moveTo(s.x1, s.y1)
          ctx.lineTo(s.x2, s.y2)
          ctx.stroke()
        }
        ctx.lineWidth = 0.9
        for (const s of ribStrokes) {
          const strength = strengthFor(s.mx, s.my)
          if (strength < 0) continue
          ctx.strokeStyle = `rgba(220, 252, 231, ${0.07 + strength * 0.38})`
          ctx.beginPath()
          ctx.moveTo(s.x1, s.y1)
          ctx.quadraticCurveTo(s.cx, s.cy, s.x2, s.y2)
          ctx.stroke()
        }
        for (const s of boneStrokes) {
          const strength = strengthFor(s.mx, s.my)
          if (strength < 0) continue
          ctx.strokeStyle = `rgba(226, 252, 236, ${0.12 + strength * 0.55})`
          ctx.lineWidth = s.w
          ctx.beginPath()
          ctx.moveTo(s.x1, s.y1)
          ctx.lineTo(s.x2, s.y2)
          ctx.stroke()
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
      if (reduceMotion && !showFull) {
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
