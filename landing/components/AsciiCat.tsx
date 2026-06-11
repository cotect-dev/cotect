import { useEffect, useRef } from 'react'
import iconUrl from '../../public/icon.svg'

// The alien cat from the logo rendered as ASCII art on a canvas: the icon's
// alpha channel is sampled into a character grid once, drawn to a persistent
// layer, then kept alive by a slow matrix-style churn of glyphs and a scanning
// shimmer. Hovering opens an x-ray window that dims the surface and brightens
// the glyphs that fall on a cartoon-radiograph cat skeleton (skull with eye
// socket and teeth, chevron spine, ribcage, limbs, capsule tail), so the
// bones appear as highlighted characters within the cat itself; moving the
// cursor fires neuron-like lightning along the bones. Append ?skeleton to
// the URL to display the full skeleton without hovering (layout review).

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

type Pt = [number, number]

// Skeleton geometry shared by the bone art and the lightning graph, in grid
// coordinates of the 69-cell icon sampling. Hand-fitted to the silhouette
// with an offline preview tool so every bone keeps a margin from the edge.
const SPINE_PTS: Pt[] = [
  [24.5, 20.8],
  [26, 23],
  [28, 26],
  [30, 30],
  [32, 34],
  [35, 38],
  [38, 42],
  [41, 45],
  [44, 48],
  [46, 50],
]

const RIBS: Array<{ from: Pt; via: Pt; to: Pt }> = [
  { from: [28.3, 27.2], via: [24.6, 31.6], to: [19.2, 31.6] },
  { from: [29.6, 29.8], via: [25, 34.8], to: [18.3, 34.6] },
  { from: [31, 32.6], via: [26.2, 38], to: [18.8, 38] },
  { from: [33, 35.8], via: [27.9, 41.3], to: [20.4, 41.2] },
  { from: [35.2, 39], via: [30.1, 44.4], to: [22.4, 44.1] },
  { from: [37.4, 41.9], via: [32.4, 46.8], to: [24.6, 46.5] },
]

const TAIL_PTS: Pt[] = [
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
]

// Chains the lightning can travel beyond the spine/ribs/tail: skull outline,
// ear, sternum, both leg bone runs.
const GRAPH_CHAINS: Pt[][] = [
  [
    [24.5, 20.2],
    [25.6, 14.8],
    [21, 11.2],
    [13.8, 12],
    [10.3, 15.2],
    [9.5, 18.2],
    [12, 20],
    [16, 21],
    [21.5, 20.7],
    [24.5, 20.2],
  ],
  [
    [19, 10.8],
    [16.4, 5],
  ],
  [
    [19, 31],
    [18, 34],
    [18.5, 37.5],
    [20, 41],
    [22, 44],
    [24.5, 46.6],
  ],
  [
    [26, 35.5],
    [23, 41.5],
    [21, 49.8],
    [20.3, 57.6],
    [20.3, 62.5],
  ],
  [
    [45.8, 52.8],
    [39.3, 55.9],
    [44.7, 62],
    [37.2, 63.2],
  ],
  SPINE_PTS,
  TAIL_PTS,
]

// The bone art itself, in the style of a cartoon radiograph: filled shapes
// with knobbed ends. Drawn once into an offscreen layer. P converts grid
// coordinates to pixels, S is the pixel size of one grid cell.
function drawSkeletonArt(ctx: CanvasRenderingContext2D, P: (g: number) => number, S: number) {
  const BONE = '#e3f7ea'
  const px = P
  const W = (g: number) => g * S

  const knobLine = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    w: number,
    knob = true,
  ): void => {
    ctx.strokeStyle = BONE
    ctx.lineCap = 'round'
    ctx.lineWidth = W(w)
    ctx.beginPath()
    ctx.moveTo(px(x1), px(y1))
    ctx.lineTo(px(x2), px(y2))
    ctx.stroke()
    if (knob) {
      ctx.fillStyle = BONE
      for (const [x, y] of [
        [x1, y1],
        [x2, y2],
      ]) {
        ctx.beginPath()
        ctx.arc(px(x), px(y), W(w) * 0.62, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  const poly = (pts: Pt[]): void => {
    ctx.beginPath()
    ctx.moveTo(px(pts[0][0]), px(pts[0][1]))
    for (let i = 1; i < pts.length; i++) ctx.lineTo(px(pts[i][0]), px(pts[i][1]))
    ctx.closePath()
  }
  const curve = (pts: Pt[]): void => {
    ctx.beginPath()
    ctx.moveTo(px(pts[0][0]), px(pts[0][1]))
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2
      const my = (pts[i][1] + pts[i + 1][1]) / 2
      ctx.quadraticCurveTo(px(pts[i][0]), px(pts[i][1]), px(mx), px(my))
    }
    ctx.lineTo(px(pts[pts.length - 1][0]), px(pts[pts.length - 1][1]))
  }

  // Skull: cranium and muzzle as one blob whose bottom edge zigzags into
  // upper teeth; eye socket and nostril punched out; separate lower jaw.
  ctx.fillStyle = BONE
  ctx.beginPath()
  ctx.moveTo(px(24.5), px(20.2))
  for (const [cx, cy, x, y] of [
    [26.3, 17.5, 25.6, 14.8],
    [24.5, 12, 21, 11.2],
    [17, 10.6, 13.8, 12],
    [11.4, 13.2, 10.3, 15.2],
    [9.5, 16.6, 9.5, 18.2],
  ]) {
    ctx.quadraticCurveTo(px(cx), px(cy), px(x), px(y))
  }
  ctx.lineTo(px(10), px(19.1))
  for (const [x, y] of [
    [10.9, 20.4],
    [11.4, 19.2],
    [12.1, 20.5],
    [12.8, 19.3],
    [13.6, 20.6],
    [14.2, 19.4],
    [15, 19.6],
  ]) {
    ctx.lineTo(px(x), px(y))
  }
  ctx.quadraticCurveTo(px(18), px(20.6), px(21.5), px(20.7))
  ctx.closePath()
  ctx.fill()
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.ellipse(px(13.4), px(15.7), W(1.85), W(1.5), -0.35, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(px(10.4), px(17.6), W(0.45), W(0.3), -0.8, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = BONE
  ctx.lineCap = 'round'
  ctx.lineWidth = W(0.85)
  curve([
    [10.8, 20.8],
    [13, 21.3],
    [16.5, 21.4],
    [19.5, 20.9],
  ])
  ctx.stroke()

  // Ear cartilage: two capsules into the right ear.
  knobLine(19, 10.8, 17.8, 7.6, 0.75)
  knobLine(17.6, 7.2, 16.4, 5, 0.65)

  // Neck and spine: thin base with chevron vertebrae; the last leg stays
  // plain so the chevrons do not pile onto the pelvis.
  ctx.lineWidth = W(0.8)
  curve(SPINE_PTS)
  ctx.stroke()
  for (let i = 0; i < SPINE_PTS.length - 2; i++) {
    const [ax, ay] = SPINE_PTS[i]
    const [bx, by] = SPINE_PTS[i + 1]
    const len = Math.hypot(bx - ax, by - ay)
    const ux = (bx - ax) / len
    const uy = (by - ay) / len
    const vx = -uy
    const vy = ux
    const n = Math.max(1, Math.round(len / 1.75))
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n
      const cx = ax + (bx - ax) * t
      const cy = ay + (by - ay) * t
      ctx.lineWidth = W(0.44)
      for (const s of [1, -1]) {
        ctx.beginPath()
        ctx.moveTo(px(cx + vx * 0.78 * s), px(cy + vy * 0.78 * s))
        ctx.lineTo(px(cx + ux * 0.8 + vx * 0.16 * s), px(cy + uy * 0.8 + vy * 0.16 * s))
        ctx.stroke()
      }
    }
  }

  // Scapula: filled blade over the front of the ribcage.
  poly([
    [25, 30.4],
    [28.8, 33.4],
    [26.6, 35.6],
    [23.4, 34.2],
  ])
  ctx.fillStyle = BONE
  ctx.fill()

  // Ribcage and sternum.
  ctx.lineWidth = W(0.8)
  for (const { from, via, to } of RIBS) {
    ctx.beginPath()
    ctx.moveTo(px(from[0]), px(from[1]))
    ctx.quadraticCurveTo(px(via[0]), px(via[1]), px(to[0]), px(to[1]))
    ctx.stroke()
  }
  ctx.lineWidth = W(0.65)
  curve([
    [19, 31],
    [18, 34],
    [18.5, 37.5],
    [20, 41],
    [22, 44],
    [24.5, 46.6],
  ])
  ctx.stroke()

  // Front leg: humerus, radius and ulna, metacarpus, three toes.
  knobLine(26, 35.5, 23, 41.5, 1.35)
  knobLine(23, 41.3, 21, 49.8, 0.95)
  knobLine(23.7, 41.9, 21.8, 49.6, 0.55, false)
  knobLine(20.8, 50.6, 20.3, 57.6, 0.95)
  knobLine(20.2, 58.4, 18.9, 62.4, 0.68)
  knobLine(20.3, 58.6, 20.3, 62.7, 0.68)
  knobLine(20.4, 58.4, 21.6, 62.2, 0.68)

  // Pelvis.
  poly([
    [44.8, 50.6],
    [47.4, 51.6],
    [47.5, 53.2],
    [45.6, 54],
    [44.2, 52.8],
  ])
  ctx.fillStyle = BONE
  ctx.fill()

  // Hind leg folded under the haunch: femur, tibia and fibula, metatarsus,
  // three toes.
  knobLine(45.8, 52.8, 39.4, 55.8, 1.25)
  knobLine(39.2, 56, 44.8, 61.8, 1.05)
  knobLine(39.9, 56.8, 44.9, 62.3, 0.55, false)
  knobLine(44.6, 62.2, 37.2, 63.2, 0.95)
  knobLine(37, 63.2, 35, 62.6, 0.6)
  knobLine(37, 63.4, 35.2, 63.6, 0.6)
  knobLine(37, 63.5, 35.6, 64.2, 0.6)

  // Tail: capsule segments along the strip, tapering toward the tip.
  const flat: Pt[] = []
  for (let i = 0; i < TAIL_PTS.length - 1; i++) {
    const [ax, ay] = TAIL_PTS[i]
    const [bx, by] = TAIL_PTS[i + 1]
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 4)
    for (let k = 0; k < n; k++) flat.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n])
  }
  flat.push(TAIL_PTS[TAIL_PTS.length - 1])
  let acc = 0
  let segStart = 0
  let segIdx = 0
  for (let i = 1; i < flat.length; i++) {
    acc += Math.hypot(flat[i][0] - flat[i - 1][0], flat[i][1] - flat[i - 1][1])
    if (acc >= 1.9) {
      const taper = 1 - segIdx * 0.05
      knobLine(flat[segStart][0], flat[segStart][1], flat[i][0], flat[i][1], 0.8 * taper, false)
      segIdx++
      let g = 0
      while (i < flat.length - 1 && g < 0.55) {
        i++
        g += Math.hypot(flat[i][0] - flat[i - 1][0], flat[i][1] - flat[i - 1][1])
      }
      segStart = i
      acc = 0
    }
  }
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
    // The skeleton sampled into the glyph grid: each entry pairs a cell with
    // how much bone covers it, so the hover highlights existing characters
    // instead of drawing a separate image. Plus a node graph for lightning.
    const boneCells: Array<{ cell: Cell; w: number }> = []
    let skelNodes: Cell[] = []
    const skelAdj = new Map<Cell, Cell[]>()
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

      // X-ray: dim the surface, then repaint the glyphs sitting on bone in a
      // bright bone tint, so the skeleton shows up as highlighted characters.
      // Hover mode does this inside a soft radial window at the cursor;
      // review mode lights the whole figure.
      if (showFull && boneCells.length) {
        ctx.save()
        ctx.globalCompositeOperation = 'destination-out'
        ctx.fillStyle = 'rgba(0, 0, 0, 0.62)'
        ctx.fillRect(0, 0, RENDER_SIZE, RENDER_SIZE)
        ctx.restore()
        for (const { cell, w } of boneCells) {
          ctx.fillStyle = `rgba(227, 247, 234, ${w * 0.95})`
          ctx.fillText(cell.char, cell.x, cell.y)
        }
      } else if (pointer && boneCells.length) {
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

        for (const { cell, w } of boneCells) {
          const d = Math.hypot(cell.x + half - pointer.x, cell.y + half - pointer.y)
          if (d >= XRAY_RADIUS) continue
          // Falloff shaped like the old radial mask: strong at the center,
          // about half strength at 70% radius, gone at the rim.
          const f = 1 - (d / XRAY_RADIUS) ** 2
          ctx.fillStyle = `rgba(227, 247, 234, ${w * f * 0.95})`
          ctx.fillText(cell.char, cell.x, cell.y)
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

      const half = CELL / 2
      const G = (g: number) => g * CELL + half

      // Rasterize the bone art once into an offscreen canvas, then collapse
      // it onto the glyph grid: each cell's coverage becomes the weight of
      // its highlight. Thin bones (chevrons, fibula) only part-fill a cell,
      // so coverage is boosted before clamping to keep them readable.
      const skel = document.createElement('canvas')
      skel.width = RENDER_SIZE
      skel.height = RENDER_SIZE
      const sctx = skel.getContext('2d', { willReadFrequently: true })
      if (sctx) {
        drawSkeletonArt(sctx, G, CELL)
        const data = sctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE).data
        const cellMap = new Map(cells.map((c) => [`${c.x},${c.y}`, c]))
        for (let y = 0; y < RENDER_SIZE; y += CELL) {
          for (let x = 0; x < RENDER_SIZE; x += CELL) {
            let sum = 0
            let count = 0
            for (let dy = 0; dy < CELL && y + dy < RENDER_SIZE; dy++) {
              for (let dx = 0; dx < CELL && x + dx < RENDER_SIZE; dx++) {
                sum += data[((y + dy) * RENDER_SIZE + x + dx) * 4 + 3]
                count++
              }
            }
            const coverage = sum / count / 255
            if (coverage < 0.08) continue
            const cell = cellMap.get(`${x},${y}`)
            if (cell) boneCells.push({ cell, w: Math.min(1, coverage * 2.4) })
          }
        }
      }

      // Lightning graph: nodes sampled along every bone chain and rib,
      // chained in order, then cross-linked where chains come close.
      const chains: Pt[][] = []
      for (const pts of GRAPH_CHAINS) {
        const chain: Pt[] = [[G(pts[0][0]), G(pts[0][1])]]
        for (let i = 1; i < pts.length; i++) {
          const [ax, ay] = pts[i - 1]
          const [bx, by] = pts[i]
          const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 1.4))
          for (let k = 1; k <= n; k++) {
            chain.push([G(ax + ((bx - ax) * k) / n), G(ay + ((by - ay) * k) / n)])
          }
        }
        chains.push(chain)
      }
      for (const r of RIBS) {
        const chain: Pt[] = []
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
