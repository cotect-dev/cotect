import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react'
import logoUrl from '../public/logo.svg'
import iconUrl from '../public/icon.svg'

// The demos pull in the full CodeMirror stack (every language package the app
// supports). Lazy-load them so the hero paints with just React on the wire.
const LiveReviewDemo = lazy(() =>
  import('./components/LiveReviewDemo').then((m) => ({ default: m.LiveReviewDemo })),
)
const PolyglotDemo = lazy(() =>
  import('./components/PolyglotDemo').then((m) => ({ default: m.PolyglotDemo })),
)

function DemoFallback({ height }: { height: number }) {
  return (
    <div
      className="rounded-lg border border-border bg-[#1e1e1e] animate-pulse"
      style={{ height }}
    />
  )
}

const CONTACT = 'mailto:grz.raczek@gmail.com?subject=cotect%20early%20access'

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
          <a href="#why" className="hover:text-foreground transition-colors max-sm:hidden">
            why
          </a>
          <a href="#languages" className="hover:text-foreground transition-colors max-sm:hidden">
            languages
          </a>
          <a
            href={CONTACT}
            className="rounded border border-green-500/40 bg-green-500/10 px-3 py-1.5 text-green-400 hover:bg-green-500/20 transition-colors"
          >
            early access
          </a>
        </nav>
      </div>
    </header>
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
          <a
            href={CONTACT}
            className="rounded-md border border-border px-5 py-2.5 font-mono text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          >
            get early access
          </a>
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

function DemoSection() {
  return (
    <section id="demo" className="relative py-24 scroll-mt-14">
      <div className="mx-auto max-w-5xl px-5">
        <Reveal>
          <HunkLabel text="-0,0 +1,3 review" />
          <h2 className="mt-4 font-mono text-2xl sm:text-3xl font-semibold tracking-tight">
            This is not a screenshot.
          </h2>
          <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed">
            The editor below is the component that ships in the desktop app — same diff engine, same
            review controls. The agent was asked to add exponential backoff to{' '}
            <code className="font-mono text-foreground/80 text-sm">fetchWithRetry</code>. It did…
            and a little more. Accept what&apos;s right, comment on what isn&apos;t.
          </p>
          <p className="mt-2 font-mono text-xs text-amber-400/90">
            hint: look closely at hunk two — nobody asked for more retries.
          </p>
        </Reveal>
        <Reveal delay={120} className="mt-8">
          <Suspense fallback={<DemoFallback height={515} />}>
            <LiveReviewDemo />
          </Suspense>
        </Reveal>
        <Reveal delay={200}>
          <p className="mt-4 font-mono text-[11px] text-muted-foreground/70">
            tip: flip <span className="text-foreground/70">read-only</span> in the header to edit —
            the diff, minimap and hunks recompute as you type.
          </p>
        </Reveal>
      </div>
    </section>
  )
}

const FEATURES = [
  {
    title: 'read-only by default',
    body: 'Files open locked. Your agents keep writing; a stale buffer can never clobber their work. Unlock a file only when you mean to change it.',
  },
  {
    title: 'live working tree',
    body: 'The whole repository is watched. When an agent touches a file you are reading, it reloads in place — and warns you first if you had unsaved edits.',
  },
  {
    title: 'hunk-by-hunk review',
    body: 'Accept or comment on every change, straight in the editor. Progress is tracked per file and per session — n of m hunks, at a glance.',
  },
  {
    title: 'review that survives restarts',
    body: 'Sessions persist locally. Quit mid-review, reopen tomorrow, and pick up on the exact hunk where you stopped.',
  },
  {
    title: 'spatial navigation',
    body: 'Folders and files unfold left-to-right as columns on an infinite canvas. Jump through imports with a modifier-click and keep your trail visible.',
  },
  {
    title: 'built for reading speed',
    body: 'Opening a file paints in ~20 ms. Diffs, minimaps and import resolution arrive after paint — never blocking the next keystroke.',
  },
]

function Features() {
  return (
    <section id="why" className="relative py-24 scroll-mt-14">
      <div className="mx-auto max-w-5xl px-5">
        <Reveal>
          <HunkLabel text="why cotect" />
          <h2 className="mt-4 font-mono text-2xl sm:text-3xl font-semibold tracking-tight">
            Reading is the new writing.
          </h2>
          <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed">
            When agents do the typing, the human job shifts to inspection. Every default in cotect
            is chosen for people who read more code than they write.
          </p>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 70}>
              <div className="feature-card h-full rounded-lg border border-border bg-card/60 p-5">
                <h3 className="font-mono text-sm text-green-400">
                  <span className="text-green-500/50 mr-2">+</span>
                  {f.title}
                </h3>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{f.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

function Languages() {
  return (
    <section id="languages" className="relative py-24 scroll-mt-14">
      <div className="mx-auto max-w-5xl px-5">
        <Reveal>
          <HunkLabel text="languages" />
          <h2 className="mt-4 font-mono text-2xl sm:text-3xl font-semibold tracking-tight">
            Reads everything your agents write.
          </h2>
          <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed">
            TypeScript, Rust, Python, Go and twenty-some more — with syntax highlighting,
            indentation guides and rainbow brackets. Switch a tab below and watch the editor remount
            from scratch; the timer is real.
          </p>
        </Reveal>
        <Reveal delay={120} className="mt-8">
          <Suspense fallback={<DemoFallback height={425} />}>
            <PolyglotDemo />
          </Suspense>
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
    desc: 'Claude Code, Codex, whatever you run — cotect watches the tree and shows their edits as they land.',
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
              href={CONTACT}
              className="mt-6 inline-block rounded-md bg-green-500/15 border border-green-500/40 px-6 py-3 font-mono text-sm text-green-300 hover:bg-green-500/25 transition-colors"
            >
              get early access
            </a>
          </div>
        </Reveal>
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
            cotect — for engineers who read more code than they write
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
        <DemoSection />
        <Features />
        <Languages />
        <HowItWorks />
      </main>
      <Footer />
    </div>
  )
}
