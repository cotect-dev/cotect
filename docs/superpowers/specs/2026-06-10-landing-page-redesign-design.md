# Landing page redesign: three real-view demos and a download CTA

Date: 2026-06-10
Status: approved

## Goal

Replace the landing page's two single-code-node demos and the text-heavy feature
grid with three demo sections, one per app view (canvas, import graph, codebase
health), each mounting the real components that ship in the desktop app. Replace
every "early access" CTA with immediate downloads.

Guiding principle (user requirement): use as many real app components as
possible so the landing page stays current as the software evolves. Adding
demo-purpose switches to app code is acceptable.

## Page structure

| Order | Section | Change |
|---|---|---|
| 1 | Nav | Keep. "early access" button becomes "download" linking to `#download`. |
| 2 | Hero | Keep headline, copy, stat line. Secondary CTA becomes an OS-aware download button. |
| 3 | Demo: Canvas ("This is not a screenshot.") | Rebuilt: real Canvas view replaces the single code node. |
| 4 | Demo: Import graph (new) | Real Graph view, seeded with the demo repo. |
| 5 | Demo: Codebase health (new) | Real Health view, seeded with the demo repo. |
| 6 | How it works ("Three steps, zero ceremony.") | Keep. Closing CTA box points to `#download`. |
| 7 | Download (new, `id="download"`) | Platform cards: Windows and macOS download buttons (stub URLs), Linux install instructions, optional macOS instructions. |
| 8 | Footer | Keep. |

Deleted outright:

- `Features` section ("Reading is the new writing.") and its six feature cards.
- `Languages` section ("Reads everything your agents write.") and
  `PolyglotDemo.tsx`.

Their content survives only as one-line captions under whichever demo shows the
behavior (for example "read-only by default · live working tree · hunk-by-hunk
review" under the canvas demo). Each demo section gets one short intro sentence,
no paragraph blocks.

## Copy style rule

All landing copy (new and retained) must read as human-written. Concretely:

- No em dashes. Use periods, commas, colons, or the existing `·` separator.
- No "it's not X, it's Y" / "this isn't X, this is Y" contrast constructions.
- No other recognizable AI-writing patterns (rule-of-three flourishes,
  "seamlessly", "effortlessly", etc.).
- The existing "This is not a screenshot." heading stays (user-approved hook).

## Demo mechanism: demo mode in real app code

A single demo flag module, `src/lib/demoMode.ts`, exporting an `isDemoMode()`
check (set once by the landing entry point before React mounts). App code
consults it at the few points where a view would touch Tauri or the filesystem.

- **Stores remain the source of truth.** The landing page seeds the real
  zustand stores (`canvasStore`, `graphStore`, `healthStore`, plus the slices of
  `browserStore`, `gitStore`, and `reviewStore` that the views read) from one
  shared fictional mini-repo dataset in `landing/demoData.ts`. Tauri lives only
  inside actions a demo never calls (`scan()`, `analyze()`, file loads); demo
  mode either skips those actions or serves content from seeded data.
- **Graph view** mounts unchanged except for a demo-mode guard on click-through
  navigation into the canvas (which would load files).
- **Health view** mounts unchanged; it renders store state. Guard any
  "navigate to file" affordances behind the demo flag.
- **Canvas view** mounts the real `CanvasFlow` with real node components.
  Demo data pre-contains the unfolded folder columns, file nodes, column edges,
  and one code node holding the agent diff (the `fetchWithRetry` exponential
  backoff story from `landing/demoCode.ts`). Drag, pan, focus, and hunk review
  work for real. Interactions that require a filesystem (`navigateRight` into
  unopened folders, file watching, persistence) are no-ops or skipped under the
  flag.
- **CodeNode content path.** `CodeNode` is the most store-entangled component
  (~850 lines). The implementation plan must pin down exactly where it acquires
  file content and diff base, and route both from seeded store data under demo
  mode. The current `LiveReviewDemo.tsx` wiring (in-memory HEAD vs agent
  change) moves into this path; `LiveReviewDemo.tsx` is then deleted.

Constraint: the three demos live on one page. Seeding must happen once at page
init (not per section) so demos do not fight over shared stores, and no demo
interaction may mutate another demo's seeded state in a way that breaks it.

## Scripted autoplay with free interaction

Each demo autoplays one short scripted sequence the first time it scrolls into
view (reusing the existing `Reveal`/IntersectionObserver pattern), then hands
control to the visitor. The first user input inside a demo cancels its script.

- **Canvas:** columns unfold left to right, the code node opens with the agent
  diff, one hunk gets accepted, the camera settles. Then free: drag nodes, pan,
  review the remaining hunks.
- **Graph:** nodes fade in, the highest-score file auto-selects to show the ego
  view with dependency and dependent edges. Then free clicking between files.
- **Health:** a brief "analyzing" beat, then findings and metrics populate.
  Then free sorting and browsing.

Scripts drive the same store actions a user would trigger, not parallel
animation state, so they exercise the real components.

## Download UX

- `landing/downloads.ts` holds all artifact URLs as constants, stubbed until
  release hosting exists, swappable in one place.
- OS detection (`navigator.userAgentData?.platform` with `navigator.platform`
  fallback) picks the hero button label: "download for macOS", "download for
  Windows", or plain "download" (scrolls to `#download`) on Linux/unknown.
- Download section cards:
  - **Windows:** installer download button (stub URL).
  - **macOS:** installer download button (stub URL) plus a one-line note on
    first launch of an unsigned build (right-click, Open).
  - **Linux:** install instructions only (no button): download the AppImage
    (stub URL), `chmod +x`, run. Plain text, trivially editable when the
    packaging story firms up.
- All former `mailto:` early-access links are removed.

## Performance

- Keep the hero payload unchanged: each demo stays lazy-loaded
  (`lazy()` + `Suspense`) as today, including the ReactFlow stack.
- Store seeding modules must not drag Tauri-API imports into eager landing
  chunks; `@tauri-apps/api` is import-safe (fails only when invoked) but should
  stay out of the critical path.

## Error handling

- Demo sections keep the existing `DemoFallback` skeleton while loading.
- A thrown demo must not blank the page: wrap each demo section in the existing
  `ErrorBoundary` with a quiet fallback card.
- Demo-mode guards fail closed: if a code path would call Tauri in the browser,
  the guard makes it a no-op rather than letting it throw.

## Testing

- Unit tests (vitest) for: demo data seeding (stores populated, shapes valid),
  demo-mode guards (Tauri-touching actions are no-ops under the flag), and OS
  detection mapping.
- Existing store tests must keep passing; demo-mode branches must not change
  non-demo behavior (flag defaults to off everywhere except the landing entry).
- Manual verification: `yarn landing:dev` plus headless Chrome screenshots of
  all sections, desktop and narrow viewport, checking console for errors.

## Out of scope

- Real release artifacts and their hosting.
- Mobile-specific demo redesign (demos render and remain scrollable on small
  screens; full touch optimization is a later pass).
- Any change to the desktop app's non-demo behavior.
