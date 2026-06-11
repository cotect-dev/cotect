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

// Height classes mirror each demo component's container so the skeleton
// does not jump when the lazy chunk arrives.
function DemoFallback({ heightClass }: { heightClass: string }) {
  return (
    <div className={`rounded-lg border border-border bg-[#1e1e1e] animate-pulse ${heightClass}`} />
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

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="mx-0.5 inline-block rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-foreground/90 align-middle">
      {children}
    </kbd>
  )
}

function Nav() {
  return (
    <header className="fixed top-0 inset-x-0 z-40 border-b border-border/60 bg-background/75 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-5 h-14 flex items-center justify-between">
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
    <section id="top" className="relative overflow-hidden pt-28 pb-16 sm:pt-36 sm:pb-24">
      <div className="hero-glow" aria-hidden />
      <img src={iconUrl} alt="" aria-hidden className="hero-cat max-sm:hidden" />
      <div className="relative mx-auto max-w-6xl px-5 hero-stagger">
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
          cotect watches your repository while agents write. Each change lands on the canvas the
          moment it happens, ready to review hunk by hunk.
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
    <section id="demo" className="relative py-16 sm:py-24 scroll-mt-14">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal>
          <HunkLabel text="-0,0 +1,3 canvas" />
          <h2 className="mt-4 font-mono text-2xl sm:text-3xl font-semibold tracking-tight">
            This is not a screenshot.
          </h2>
          <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed">
            The canvas below is the real cotect editor, the same component the desktop app ships. It
            opened a small repository on its own. Now it is yours: click into it and move between
            files with <Kbd>W</Kbd>
            <Kbd>A</Kbd>
            <Kbd>S</Kbd>
            <Kbd>D</Kbd>, drag the nodes, and review the change an agent just made to{' '}
            <code className="font-mono text-foreground/80 text-sm">fetchWithRetry.ts</code>. The
            Changes and History panels are live too, exactly as they dock in the app.
          </p>
          <p className="mt-2 font-mono text-xs text-amber-400/90">
            hint: look closely at hunk two. nobody asked for more retries.
          </p>
        </Reveal>
        <Reveal delay={120} className="mt-8">
          <DemoBoundary>
            <Suspense fallback={<DemoFallback heightClass="h-[916px] sm:h-[876px]" />}>
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
    <section id="graph" className="relative py-16 sm:py-24 scroll-mt-14">
      <div className="mx-auto max-w-6xl px-5">
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
            <Suspense fallback={<DemoFallback heightClass="h-[480px] sm:h-[640px]" />}>
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
    <section id="health" className="relative py-16 sm:py-24 scroll-mt-14">
      <div className="mx-auto max-w-6xl px-5">
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
            <Suspense fallback={<DemoFallback heightClass="h-[480px] sm:h-[560px]" />}>
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

function HowItWorks() {
  return (
    <section className="relative py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal>
          <HunkLabel text="workflow" />
          <h2 className="mt-4 font-mono text-2xl sm:text-3xl font-semibold tracking-tight">
            Three steps, zero ceremony.
          </h2>
        </Reveal>
        <Reveal delay={120} className="mt-8">
          <div className="rounded-lg border border-border bg-[#161616] overflow-hidden">
            <div className="flex items-center gap-1.5 border-b border-border/60 px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500/40" />
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/40" />
              <span className="h-2.5 w-2.5 rounded-full bg-green-500/40" />
            </div>
            <div className="p-5 sm:p-6 font-mono text-[13px] sm:text-sm leading-relaxed space-y-1">
              <p className="text-amber-400/80"># 1 · open your repo in cotect</p>
              <p>
                <span className="text-green-500/60 mr-2">$</span>cotect ~/dev/relay
              </p>
              <p className="text-muted-foreground">watching working tree · read-only</p>
              <p className="pt-5 text-amber-400/80"># 2 · let your agents work</p>
              <p>
                <span className="text-green-500/60 mr-2">$</span>claude "add retry backoff to the
                fetch helper"
              </p>
              <p className="text-muted-foreground">
                fetchWithRetry.ts changed · 3 hunks appear on the canvas
              </p>
              <p className="pt-5 text-amber-400/80"># 3 · review every hunk before it ships</p>
              <p className="text-green-400">
                hunk 1 accepted · hunk 2 commented · working tree untouched
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

const PLATFORMS = ['windows', 'mac', 'linux'] as const
type Platform = (typeof PLATFORMS)[number]

function PlatformCard({ platform, detected }: { platform: Platform; detected: boolean }) {
  const boxClass = detected
    ? 'border-green-500/40 bg-green-500/5'
    : 'border-border bg-card/40 opacity-80'
  return (
    <div className={`rounded-lg border p-5 sm:p-6 ${boxClass}`}>
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-muted-foreground/60">
          {platform === 'mac' ? 'macos' : platform}
        </span>
        {detected && (
          <span className="rounded border border-green-500/40 bg-green-500/10 px-1.5 py-0.5 font-mono text-[10px] text-green-400">
            your system
          </span>
        )}
      </div>
      {platform === 'linux' ? (
        <pre className="mt-4 rounded bg-[#1e1e1e] p-3 sm:p-4 font-mono text-[11px] sm:text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
          {`curl -LO ${DOWNLOADS.linux.appImageUrl}\nchmod +x cotect.AppImage\n./cotect.AppImage`}
        </pre>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
          <a
            href={DOWNLOADS[platform].url}
            className="rounded-md bg-green-500/15 border border-green-500/40 px-4 py-2 font-mono text-sm text-green-300 hover:bg-green-500/25 transition-colors"
          >
            {DOWNLOADS[platform].label}
          </a>
          {platform === 'mac' && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              unsigned build for now: right-click the app and choose Open on first launch.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function DownloadSection() {
  const [os] = useState(() => detectOS())
  const detected = os === 'unknown' ? null : os
  const ordered = detected ? [detected, ...PLATFORMS.filter((p) => p !== detected)] : [...PLATFORMS]
  return (
    <section id="download" className="relative py-16 sm:py-24 scroll-mt-14">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal>
          <HunkLabel text="download" />
          <h2 className="mt-4 font-mono text-2xl sm:text-3xl font-semibold tracking-tight">
            Download cotect.
          </h2>
          <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed">
            Free while in development. Point it at a repository and start reading.
          </p>
        </Reveal>
        <div className="mt-10 space-y-4">
          {ordered.map((p, i) => (
            <Reveal key={p} delay={i * 90}>
              <PlatformCard platform={p} detected={p === detected} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-border/60 py-10">
      <div className="mx-auto max-w-6xl px-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <img src={iconUrl} alt="" className="h-5 w-5" />
          <span className="font-mono text-xs text-muted-foreground">
            cotect · verify the change
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
