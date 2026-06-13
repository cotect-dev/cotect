import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import logoUrl from '../public/logo.svg'
import iconUrl from '../public/icon.svg'
import { DemoBoundary } from './components/DemoBoundary'
import { AsciiCat } from './components/AsciiCat'
import { seedReady } from './seed'
import { DOWNLOADS, detectOS, detectLinuxPkg, REPO_URL } from './downloads'
import {
  AppleIcon,
  LinuxIcon,
  WindowsIcon,
  GitHubIcon,
  LinkedInIcon,
  XIcon,
  BlueskyIcon,
} from './icons'

const SOCIAL_ICONS = [
  { label: 'GitHub', href: REPO_URL, Icon: GitHubIcon },
  { label: 'X', href: 'https://x.com/cotect_dev', Icon: XIcon },
  { label: 'LinkedIn', href: 'https://linkedin.com/company/cotect-dev', Icon: LinkedInIcon },
  { label: 'Bluesky', href: 'https://bsky.app/profile/cotect.dev', Icon: BlueskyIcon },
] as const

// The demos pull in the full app stack (ReactFlow, every CodeMirror language
// package). Lazy-load them so the hero paints with just React on the wire,
// and gate each on the store seeding kicked off by ./seed.
const CanvasDemo = lazy(() =>
  Promise.all([seedReady, import('./components/CanvasDemo')]).then(([, m]) => ({
    default: m.CanvasDemo,
  })),
)
const GraphDemo = lazy(() =>
  Promise.all([seedReady, import('./components/GraphDemo')]).then(([, m]) => ({
    default: m.GraphDemo,
  })),
)
const HealthDemo = lazy(() =>
  Promise.all([seedReady, import('./components/HealthDemo')]).then(([, m]) => ({
    default: m.HealthDemo,
  })),
)
// The phone demo mounts the real CodeNode, so it needs the same store seeding
// the canvas demo does.
const MobileCodeNodeDemo = lazy(() =>
  Promise.all([seedReady, import('./components/MobileCodeNodeDemo')]).then(([, m]) => ({
    default: m.MobileCodeNodeDemo,
  })),
)
// The phone graph mounts the real Graph component, so it needs the same store
// seeding the desktop graph does.
const MobileGraphDemo = lazy(() =>
  Promise.all([seedReady, import('./components/MobileGraphDemo')]).then(([, m]) => ({
    default: m.MobileGraphDemo,
  })),
)

// Height classes mirror each demo component's container so the skeleton
// does not jump when the lazy chunk arrives.
function DemoFallback({ heightClass }: { heightClass: string }) {
  return (
    <div className={`rounded-lg border border-border bg-[#1e1e1e] animate-pulse ${heightClass}`} />
  )
}

// Defers mounting (and so chunk downloads) until the section nears the
// viewport, keeping the heavy editor bundle off the hero's critical path.
function NearViewport({ children, heightClass }: { children: ReactNode; heightClass: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true)
          io.disconnect()
        }
      },
      { rootMargin: '600px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return <div ref={ref}>{near ? children : <DemoFallback heightClass={heightClass} />}</div>
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

/** Tag-style caption: each tag wraps as a whole unit instead of mid-phrase. */
function TagLine({
  items,
  className = '',
  style,
}: {
  items: string[]
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <p
      className={`flex flex-wrap gap-x-2 gap-y-1 font-mono text-[11px] text-muted-foreground/70 ${className}`}
      style={style}
    >
      {items.map((item, i) => (
        <span key={item} className="whitespace-nowrap">
          {item}
          {i < items.length - 1 && <span className="ml-2 text-foreground/20">·</span>}
        </span>
      ))}
    </p>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="mx-0.5 inline-block rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-foreground/90 align-middle">
      {children}
    </kbd>
  )
}

function Nav() {
  // Starts tall with a larger logo, condenses once the page scrolls.
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <header className="fixed top-0 inset-x-0 z-40 border-b border-border/60 bg-background/75 backdrop-blur-md">
      <div
        className={`mx-auto max-w-6xl px-5 flex items-center justify-between transition-[height] duration-300 ${
          scrolled ? 'h-14' : 'h-20 sm:h-24'
        }`}
      >
        <a href="#top" className="flex items-center gap-2">
          <img
            src={logoUrl}
            alt="cotect"
            className={`w-auto transition-[height] duration-300 ${scrolled ? 'h-6' : 'h-9 sm:h-10'}`}
          />
        </a>
        <nav className="flex items-center gap-5 font-mono text-xs text-muted-foreground">
          <a href="#demo" className="hover:text-foreground transition-colors max-sm:hidden">
            demo
          </a>
          <a href="#faq" className="hover:text-foreground transition-colors max-sm:hidden">
            faq
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <GitHubIcon className="h-[18px] w-[18px]" />
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
      <div className="aurora" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <AsciiCat className="hero-cat max-sm:hidden" />
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
          {/* Desktop: download the app. Mobile: that's a dead end (you can't
              install a desktop tool on a phone), so point at the repo instead —
              one tap, works logged out, and it's where the project's trust lives. */}
          <div className="max-sm:hidden">
            <HeroDownloadButton />
          </div>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="sm:hidden rounded-md border border-border px-5 py-2.5 font-mono text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          >
            view on github
          </a>
        </div>
        <TagLine
          className="mt-10"
          style={{ ['--i' as string]: 5 }}
          items={[
            'read-only by default',
            'live working tree',
            'hunk-by-hunk review',
            '~20 ms file opens',
          ]}
        />
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
          {/* Keyboard copy for the real editor; touch copy for the phone demo. */}
          <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed max-sm:hidden">
            This is the real cotect editor with a small repository open. Press <Kbd>W</Kbd>
            <Kbd>A</Kbd>
            <Kbd>S</Kbd>
            <Kbd>D</Kbd> to move between files and review the change an agent just made to{' '}
            <code className="font-mono text-foreground/80 text-sm">fetchWithRetry.ts</code>. All
            comments you leave can be copied into an agent of your choice.
          </p>
          <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed sm:hidden">
            This is the real cotect editor, showing the change an agent just made to{' '}
            <code className="font-mono text-foreground/80 text-sm">fetchWithRetry.ts</code>. Review
            it hunk by hunk: accept what's good, comment on what isn't, and copy your notes into the
            agent of your choice.
          </p>
          <p className="mt-2 font-mono text-xs text-amber-400/90">
            hint: look closely at hunk two. nobody asked for more retries.
          </p>
        </Reveal>
        {/* Phones get a single real CodeNode (the diff/review component on its
            own); sm+ gets the full multi-column canvas editor. */}
        <Reveal delay={120} className="mt-8 sm:hidden">
          <NearViewport heightClass="h-[620px]">
            <DemoBoundary>
              <Suspense fallback={<DemoFallback heightClass="h-[620px]" />}>
                <MobileCodeNodeDemo />
              </Suspense>
            </DemoBoundary>
          </NearViewport>
        </Reveal>
        <Reveal delay={120} className="mt-8 max-sm:hidden">
          <NearViewport heightClass="h-[876px]">
            <DemoBoundary>
              <Suspense fallback={<DemoFallback heightClass="h-[876px]" />}>
                <CanvasDemo />
              </Suspense>
            </DemoBoundary>
          </NearViewport>
        </Reveal>
        <Reveal delay={200}>
          <TagLine
            className="mt-4"
            items={['read-only by default', 'live working tree', 'hunk-by-hunk review']}
          />
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
          <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed max-sm:hidden">
            cotect resolves imports across the codebase and draws the result. Click any file to see
            what it pulls in and what depends on it. Agents only write as well as you direct them,
            and keeping the shape of the project in your head is what makes your direction good.
          </p>
          <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed sm:hidden">
            cotect resolves imports across the codebase and draws the result, so you can see what
            each file pulls in and what depends on it. Agents only write as well as you direct them,
            and keeping the shape of the project in your head is what makes your direction good.
          </p>
        </Reveal>
        {/* Phones get a small fixed slice of the graph with interaction off;
            sm+ gets the real, interactive ego graph. */}
        <Reveal delay={120} className="mt-8 sm:hidden">
          <NearViewport heightClass="h-[340px]">
            <DemoBoundary>
              <Suspense fallback={<DemoFallback heightClass="h-[340px]" />}>
                <MobileGraphDemo />
              </Suspense>
            </DemoBoundary>
          </NearViewport>
        </Reveal>
        <Reveal delay={120} className="mt-8 max-sm:hidden">
          <NearViewport heightClass="h-[640px]">
            <DemoBoundary>
              <Suspense fallback={<DemoFallback heightClass="h-[640px]" />}>
                <GraphDemo />
              </Suspense>
            </DemoBoundary>
          </NearViewport>
        </Reveal>
        <Reveal delay={200}>
          <TagLine
            className="mt-4"
            items={['import resolution', 'dependency and dependent edges', 'test files marked']}
          />
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
          <NearViewport heightClass="h-[480px] sm:h-[560px]">
            <DemoBoundary>
              <Suspense fallback={<DemoFallback heightClass="h-[480px] sm:h-[560px]" />}>
                <HealthDemo />
              </Suspense>
            </DemoBoundary>
          </NearViewport>
        </Reveal>
        <Reveal delay={200}>
          <TagLine
            className="mt-4"
            items={['circular dependencies', 'hotspots', 'context window fit']}
          />
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
            Open, watch, review.
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
                <span className="text-green-500/60 mr-2">$</span>claude -p "add retry backoff to the
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

/** A shell snippet with a copy button; one click on the block also selects it all. */
function CopyableCommand({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }
  return (
    <div className="relative">
      <pre className="select-all rounded bg-[#1e1e1e] p-3 sm:p-4 pr-14 font-mono text-[11px] sm:text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
        {text}
      </pre>
      <button
        onClick={copy}
        aria-label="Copy commands"
        className="absolute top-2 right-2 rounded border border-border bg-background/70 px-2 py-1 font-mono text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  )
}

/** Copies the site URL so a phone visitor can paste it to themselves and open
 *  cotect on a desktop later. */
function CopyLink() {
  const [copied, setCopied] = useState(false)
  const url = 'https://cotect.dev'
  const copy = () => {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 font-mono text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
    >
      {copied ? 'link copied' : 'copy cotect.dev'}
    </button>
  )
}

// Green primary for the recommended package, muted outline for the alternative.
function linuxBtn(primary: boolean): string {
  return primary
    ? 'rounded-md bg-green-500/15 border border-green-500/40 px-4 py-2 font-mono text-sm text-green-300 hover:bg-green-500/25 transition-colors'
    : 'rounded-md border border-border px-4 py-2 font-mono text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors'
}

function PlatformCard({ platform, detected }: { platform: Platform; detected: boolean }) {
  const boxClass = detected
    ? 'border-green-500/40 bg-green-500/5'
    : 'border-border bg-card/40 opacity-80'
  const preferredLinuxPkg = detectLinuxPkg()
  const OsIcon = platform === 'mac' ? AppleIcon : platform === 'windows' ? WindowsIcon : LinuxIcon
  return (
    <div className={`rounded-lg border p-5 sm:p-6 ${boxClass}`}>
      <div className="flex items-center gap-2.5">
        <OsIcon className="h-4 w-4 text-muted-foreground/80" />
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
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <a href={DOWNLOADS.linux.debUrl} className={linuxBtn(preferredLinuxPkg === 'deb')}>
              .deb (Ubuntu, Debian)
            </a>
            <a href={DOWNLOADS.linux.rpmUrl} className={linuxBtn(preferredLinuxPkg === 'rpm')}>
              .rpm (Fedora, openSUSE)
            </a>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            installs like any app, with a launcher entry.
          </p>
          <div className="space-y-1.5">
            <p className="font-mono text-xs text-muted-foreground/60">or the portable AppImage</p>
            <CopyableCommand
              text={`curl -LO ${DOWNLOADS.linux.appImageUrl}\nchmod +x cotect.AppImage\n./cotect.AppImage`}
            />
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
          <a
            href={DOWNLOADS[platform].url}
            className="rounded-md bg-green-500/15 border border-green-500/40 px-4 py-2 font-mono text-sm text-green-300 hover:bg-green-500/25 transition-colors"
          >
            {DOWNLOADS[platform].label}
          </a>
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
            Free and open source. Point it at a repository and start reading.
          </p>
          {/* On a phone none of these install, but the cards still answer "what
              does it run on?". Frame it and offer a way to pick this back up on
              a desktop. */}
          <div className="mt-5 sm:hidden">
            <p className="text-sm text-muted-foreground/80 leading-relaxed">
              cotect is a desktop app. Open it on your computer to install, or send yourself the
              link.
            </p>
            <div className="mt-3">
              <CopyLink />
            </div>
          </div>
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

const FAQ: { q: string; lead: string; a: ReactNode }[] = [
  {
    q: 'Is cotect free? How will it make money?',
    lead: 'Free and open source, forever.',
    a: (
      <>
        cotect is Apache-2.0 and free for individual use. The plan for making it sustainable is paid
        team features later, like shared reviews and collaboration, once they exist. The core app
        stays free, with no bait and switch. If a tool reads your code all day, you should be able
        to read its code too:{' '}
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="text-green-400 hover:text-green-300 transition-colors"
        >
          github.com/cotect-dev/cotect
        </a>
        .
      </>
    ),
  },
  {
    q: 'Does my code leave my machine?',
    lead: 'No.',
    a: 'cotect reads your repository locally and renders everything on your own machine. The only time it reaches the network is to check github.com for new versions.',
  },
  {
    q: 'Which agents does it work with?',
    lead: 'Any of them.',
    a: 'cotect watches your repository files and Git state, so it surfaces changes from any coding agent or editor that touches your repo, whether that is Claude Code, Codex, OpenCode, or your own hand edits.',
  },
  {
    q: 'Will it change my code?',
    lead: 'Never.',
    a: 'cotect is read-first. It does not write to your working tree, stage, or commit for you. It shows you what changed so you can review it hunk by hunk and decide what to do.',
  },
  {
    q: 'Which platforms are supported?',
    lead: 'macOS, Windows, and Linux.',
    a: 'Grab a build from the download section above.',
  },
]

function FAQSection() {
  return (
    <section id="faq" className="relative py-16 sm:py-24 scroll-mt-14">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal>
          <HunkLabel text="faq" />
          <h2 className="mt-4 font-mono text-2xl sm:text-3xl font-semibold tracking-tight">
            Frequently asked questions.
          </h2>
        </Reveal>
        <dl className="mt-10 max-w-3xl divide-y divide-border/60">
          {FAQ.map((item, i) => (
            <Reveal key={item.q} delay={i * 40}>
              <div className="py-5">
                <dt className="font-mono text-base sm:text-lg font-medium text-foreground">
                  {item.q}
                </dt>
                <dd className="mt-2 text-muted-foreground leading-relaxed">
                  <span className="font-semibold text-foreground">{item.lead} </span>
                  {item.a}
                </dd>
              </div>
            </Reveal>
          ))}
        </dl>
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
        <div className="flex items-center gap-4 font-mono text-[11px] text-muted-foreground/60">
          <span className="flex items-center gap-3.5">
            {SOCIAL_ICONS.map(({ label, href, Icon }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={label}
                className="text-muted-foreground/60 hover:text-foreground transition-colors"
              >
                <Icon className="h-4 w-4" />
              </a>
            ))}
          </span>
          <span>© 2026 cotect</span>
        </div>
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
        <FAQSection />
      </main>
      <Footer />
    </div>
  )
}
