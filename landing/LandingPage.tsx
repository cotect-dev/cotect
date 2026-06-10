import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import logoUrl from '../public/logo.svg'
import iconUrl from '../public/icon.svg'
import { DemoBoundary } from './components/DemoBoundary'
import { DOWNLOADS, detectOS } from './downloads'

// The demos pull in the full app stack (ReactFlow, every CodeMirror language
// package). Lazy-load them so the hero paints with just React on the wire.
const CanvasDemo = lazy(() =>
  import('./components/CanvasDemo').then((m) => ({ default: m.CanvasDemo })),
)
const GraphDemo = lazy(() =>
  import('./components/GraphDemo').then((m) => ({ default: m.GraphDemo })),
)
const HealthDemo = lazy(() =>
  import('./components/HealthDemo').then((m) => ({ default: m.HealthDemo })),
)

function DemoFallback({ height }: { height: number }) {
  return (
    <div
      className="rounded-lg border border-border bg-[#1e1e1e] animate-pulse"
      style={{ height }}
    />
  )
}

/** Scroll-triggered reveal: children animate up once when they enter the viewport. */
function Reveal({
  children,
  className = '',
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('in')
          io.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref} className={`reveal ${className}`} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  )
}

/** Section label styled as a unified-diff hunk header. */
function HunkLabel({ text }: { text: string }) {
  return <span className="hunk-label">{`@@ ${text} @@`}</span>
}

function Nav() {
  return (
    <header className="fixed top-0 inset-x-0 z-40 border-b border-border/60 bg-background/75 backdrop-blur-md">
      <div className="mx-auto max-w-5xl px-5 h-14 flex items-center justify-between">
        <a href="#top" className="flex items-center gap-2">
          <img src={logoUrl} alt="cotect" className="h-6 w-auto" />
        </a>
        <nav className="flex items-center gap-5 font-mono text-xs text-muted-foreground">
          <a href="#demo" className="hover:text-foreground transition-colors max-sm:hidden">
            demo
          </a>
          <a href="#graph" className="hover:text-foreground transition-colors max-sm:hidden">
            graph
          </a>
          <a href="#health" className="hover:text-foreground transition-colors max-sm:hidden">
            health
          </a>
          <a
            href="#download"
            className="rounded border border-green-500/40 bg-green-500/10 px-3 py-1.5 text-green-400 hover:bg-green-500/20 transition-colors"
          >
            download
          </a>
        </nav>
      </div>
    </header>
  )
}

function HeroDownloadButton() {
  const [os] = useState(() => detectOS())
  const label =
    os === 'mac' ? DOWNLOADS.mac.label : os === 'windows' ? DOWNLOADS.windows.label : 'download'
  const href =
    os === 'mac' ? DOWNLOADS.mac.url : os === 'windows' ? DOWNLOADS.windows.url : '#download'
  return (
    <a
      href={href}
      className="rounded-md border border-border px-5 py-2.5 font-mono text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
    >
      {label.toLowerCase()}
    </a>
  )
}

function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-36 pb-24">
      <div className="hero-glow" aria-hidden />
      <div className="relative mx-auto max-w-5xl px-5 hero-stagger">
        <p className="font-mono text-xs text-muted-foreground" style={{ ['--i' as string]: 0 }}>
          cotect <span className="text-foreground/30">/</span> a code inspector for the agent era
        </p>
        <h1 className="mt-8 font-mono font-semibold tracking-tight text-[clamp(1.6rem,5.2vw,3.6rem)] leading-[1.25]">
          <span className="diff-line diff-del block" style={{ ['--i' as string]: 1 }}>
            <span className="diff-sign">-</span>
            <span className="diff-del-text">trust the agent.</span>
          </span>
          <span className="diff-line diff-add block" style={{ ['--i' as string]: 2 }}>
            <span className="diff-sign">+</span>
            <span>verify the change.</span>
          </span>
        </h1>
        <p
          className="mt-8 max-w-xl text-base sm:text-lg text-muted-foreground leading-relaxed"
          style={{ ['--i' as string]: 3 }}
        >
          Agents write code faster than anyone can read it. cotect is a fast, read‑first code
          inspector: watch AI‑written changes land in your repository live, navigate them on an
          infinite canvas, and review every hunk before it ships.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3" style={{ ['--i' as string]: 4 }}>
          <a
            href="#demo"
            className="rounded-md bg-green-500/15 border border-green-500/40 px-5 py-2.5 font-mono text-sm text-green-300 hover:bg-green-500/25 transition-colors"
          >
            try the live demo ↓
          </a>
          <HeroDownloadButton />
        </div>
        <p
          className="mt-10 font-mono text-[11px] text-muted-foreground/70"
          style={{ ['--i' as string]: 5 }}
        >
          read-only by default <span className="mx-2 text-foreground/20">·</span> live working tree{' '}
          <span className="mx-2 text-foreground/20">·</span> hunk-by-hunk review{' '}
          <span className="mx-2 text-foreground/20">·</span> ~20 ms file opens
        </p>
      </div>
    </section>
  )
}

function CanvasSection() {
  return (
    <section id="demo" className="relative py-24 scroll-mt-14">
      <div className="mx-auto max-w-5xl px-5">
        <Reveal>
          <HunkLabel text="-0,0 +1,3 canvas" />
          <h2 className="mt-4 font-mono text-2xl sm:text-3xl font-semibold tracking-tight">
            This is not a screenshot.
          </h2>
          <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed">
            The canvas below is the real cotect editor, the same component the desktop app ships. It
            opened a small repository on its own. Now it is yours: drag the nodes, pan around, and
            review the change an agent just made to{' '}
            <code className="font-mono text-foreground/80 text-sm">fetchWithRetry.ts</code>.
          </p>
          <p className="mt-2 font-mono text-xs text-amber-400/90">
            hint: look closely at hunk two. nobody asked for more retries.
          </p>
        </Reveal>
        <Reveal delay={120} className="mt-8">
          <DemoBoundary>
            <Suspense fallback={<DemoFallback height={560} />}>
              <CanvasDemo />
            </Suspense>
          </DemoBoundary>
        </Reveal>
        <Reveal delay={200}>
          <p className="mt-4 font-mono text-[11px] text-muted-foreground/70">
            read-only by default · live working tree · hunk-by-hunk review
          </p>
        </Reveal>
      </div>
    </section>
  )
}

function GraphSection() {
  return (
    <section id="graph" className="relative py-24 scroll-mt-14">
      <div className="mx-auto max-w-5xl px-5">
        <Reveal>
          <HunkLabel text="import graph" />
          <h2 className="mt-4 font-mono text-2xl sm:text-3xl font-semibold tracking-tight">
            See the shape of the repository.
          </h2>
          <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed">
            cotect resolves imports across the codebase and draws the result. Click any file to see
            what it pulls in and what depends on it.
          </p>
        </Reveal>
        <Reveal delay={120} className="mt-8">
          <DemoBoundary>
            <Suspense fallback={<DemoFallback height={480} />}>
              <GraphDemo />
            </Suspense>
          </DemoBoundary>
        </Reveal>
        <Reveal delay={200}>
          <p className="mt-4 font-mono text-[11px] text-muted-foreground/70">
            import resolution · dependency and dependent edges · test files marked
          </p>
        </Reveal>
      </div>
    </section>
  )
}

function HealthSection() {
  return (
    <section id="health" className="relative py-24 scroll-mt-14">
      <div className="mx-auto max-w-5xl px-5">
        <Reveal>
          <HunkLabel text="codebase health" />
          <h2 className="mt-4 font-mono text-2xl sm:text-3xl font-semibold tracking-tight">
            Know where it hurts.
          </h2>
          <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed">
            Structural findings, churn hotspots and oversized files, computed from the repository
            itself. Sort the table and judge for yourself.
          </p>
        </Reveal>
        <Reveal delay={120} className="mt-8">
          <DemoBoundary>
            <Suspense fallback={<DemoFallback height={560} />}>
              <HealthDemo />
            </Suspense>
          </DemoBoundary>
        </Reveal>
        <Reveal delay={200}>
          <p className="mt-4 font-mono text-[11px] text-muted-foreground/70">
            circular dependencies · hotspots · context window fit
          </p>
        </Reveal>
      </div>
    </section>
  )
}

const STEPS = [
  {
    n: '01',
    cmd: 'point cotect at a repo',
    desc: 'Any local git repository. No remote, no setup, no daemon.',
  },
  {
    n: '02',
    cmd: 'let the agents loose',
    desc: 'Claude Code, Codex, whatever you run. cotect watches the tree and shows their edits as they land.',
  },
  {
    n: '03',
    cmd: 'review hunks as they ship',
    desc: 'Accept, comment, track progress. Your review never mutates the working tree, so agents are never blocked.',
  },
]

function HowItWorks() {
  return (
    <section className="relative py-24">
      <div className="mx-auto max-w-5xl px-5">
        <Reveal>
          <HunkLabel text="workflow" />
          <h2 className="mt-4 font-mono text-2xl sm:text-3xl font-semibold tracking-tight">
            Three steps, zero ceremony.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 90}>
              <div className="h-full rounded-lg border border-border bg-card/40 p-5">
                <div className="font-mono text-xs text-muted-foreground/60">{s.n}</div>
                <div className="mt-2 font-mono text-sm text-foreground">
                  <span className="text-green-500/60 mr-2">$</span>
                  {s.cmd}
                </div>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={280}>
          <div className="mt-16 rounded-lg border border-green-500/25 bg-green-500/5 p-8 text-center">
            <p className="font-mono text-lg sm:text-xl">
              <span className="text-red-400/80 line-through decoration-red-400/60 mr-3">
                merge and hope
              </span>
              <span className="text-green-400">review and know</span>
            </p>
            <a
              href="#download"
              className="mt-6 inline-block rounded-md bg-green-500/15 border border-green-500/40 px-6 py-3 font-mono text-sm text-green-300 hover:bg-green-500/25 transition-colors"
            >
              download
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function DownloadSection() {
  return (
    <section id="download" className="relative py-24 scroll-mt-14">
      <div className="mx-auto max-w-5xl px-5">
        <Reveal>
          <HunkLabel text="download" />
          <h2 className="mt-4 font-mono text-2xl sm:text-3xl font-semibold tracking-tight">
            Download cotect.
          </h2>
          <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed">
            Free while in development. Point it at a repository and start reading.
          </p>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <Reveal delay={0}>
            <div className="h-full rounded-lg border border-border bg-card/40 p-5">
              <div className="font-mono text-xs text-muted-foreground/60">windows</div>
              <a
                href={DOWNLOADS.windows.url}
                className="mt-3 inline-block rounded-md bg-green-500/15 border border-green-500/40 px-4 py-2 font-mono text-sm text-green-300 hover:bg-green-500/25 transition-colors"
              >
                Download for Windows
              </a>
            </div>
          </Reveal>
          <Reveal delay={90}>
            <div className="h-full rounded-lg border border-border bg-card/40 p-5">
              <div className="font-mono text-xs text-muted-foreground/60">macos</div>
              <a
                href={DOWNLOADS.mac.url}
                className="mt-3 inline-block rounded-md bg-green-500/15 border border-green-500/40 px-4 py-2 font-mono text-sm text-green-300 hover:bg-green-500/25 transition-colors"
              >
                Download for macOS
              </a>
              <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                unsigned build for now: right-click the app and choose Open on first launch.
              </p>
            </div>
          </Reveal>
          <Reveal delay={180}>
            <div className="h-full rounded-lg border border-border bg-card/40 p-5">
              <div className="font-mono text-xs text-muted-foreground/60">linux</div>
              <pre className="mt-3 rounded bg-[#1e1e1e] p-3 font-mono text-[11px] leading-relaxed text-muted-foreground overflow-x-auto">
                {`curl -LO ${DOWNLOADS.linux.appImageUrl}\nchmod +x cotect.AppImage\n./cotect.AppImage`}
              </pre>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-border/60 py-10">
      <div className="mx-auto max-w-5xl px-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <img src={iconUrl} alt="" className="h-5 w-5" />
          <span className="font-mono text-xs text-muted-foreground">
            cotect · for engineers who read more code than they write
          </span>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground/60">© 2026 cotect</span>
      </div>
    </footer>
  )
}

export function LandingPage() {
  return (
    <div className="landing min-h-screen">
      <div className="grain" aria-hidden />
      <Nav />
      <main>
        <Hero />
        <CanvasSection />
        <GraphSection />
        <HealthSection />
        <HowItWorks />
        <DownloadSection />
      </main>
      <Footer />
    </div>
  )
}
