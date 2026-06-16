#!/usr/bin/env node
// Start a new release branch and bump every version string in one shot.
//
// Cotect releases are tag-driven: pushing a `v*` tag fires .github/workflows/
// release.yml, which builds the 3-OS matrix and drafts a GitHub release. This
// script prepares the commit that a release tag will point at. It creates a
// `release/vX.Y.Z` branch, rewrites the version in every source of truth, rolls
// the CHANGELOG's Unreleased section into a dated entry, commits, and (unless
// told otherwise) pushes the branch so PRs can be retargeted onto it.
//
// Usage:
//   node scripts/release-start.mjs <version|major|minor|patch> [options]
//   yarn release:start 0.3.0
//   yarn release:start minor
//
// Options:
//   --branch <name>   Override the branch name (default: release/v<version>)
//   --base <branch>   Branch to cut from (default: main)
//   --no-push         Create the branch locally but do not push to origin
//   --no-commit       Bump files but leave them unstaged (no branch, no commit)
//   --date <YYYY-MM-DD>  CHANGELOG release date (default: today)
//   --dry-run         Print what would change without touching anything
//   -h, --help        Show this help

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
}
const paint = (c, s) => `${COLORS[c]}${s}${COLORS.reset}`
const info = (s) => console.log(s)
const step = (s) => console.log(paint('cyan', `→ ${s}`))
const done = (s) => console.log(paint('green', `✓ ${s}`))
const warn = (s) => console.log(paint('yellow', `! ${s}`))

function fail(msg) {
  console.error(paint('red', `✗ ${msg}`))
  process.exit(1)
}

function help() {
  // The banner comment above is the canonical reference; keep this terse.
  info(`${paint('bold', 'release-start')} — cut a release branch and bump versions

Usage:
  yarn release:start <version|major|minor|patch> [options]

Options:
  --branch <name>      Override branch name (default: release/v<version>)
  --base <branch>      Branch to cut from (default: main)
  --date <YYYY-MM-DD>  CHANGELOG release date (default: today)
  --no-push            Do not push the branch to origin
  --no-commit          Bump files only; no branch, no commit
  --dry-run            Show changes without writing anything
  -h, --help           Show this help`)
}

function parseArgs(argv) {
  const opts = {
    versionArg: null,
    branch: null,
    base: 'main',
    push: true,
    commit: true,
    date: null,
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '-h':
      case '--help':
        help()
        process.exit(0)
        break
      case '--branch':
        opts.branch = argv[++i]
        break
      case '--base':
        opts.base = argv[++i]
        break
      case '--date':
        opts.date = argv[++i]
        break
      case '--no-push':
        opts.push = false
        break
      case '--no-commit':
        opts.commit = false
        break
      case '--dry-run':
        opts.dryRun = true
        break
      default:
        if (a.startsWith('-')) fail(`Unknown option: ${a}`)
        else if (opts.versionArg) fail(`Unexpected extra argument: ${a}`)
        else opts.versionArg = a
    }
  }
  if (!opts.versionArg) {
    help()
    fail('A version (or major|minor|patch) is required.')
  }
  return opts
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

function parseSemver(v) {
  const m = SEMVER.exec(v)
  if (!m) fail(`Not a valid X.Y.Z version: ${v}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function bump(current, kind) {
  const [maj, min, pat] = parseSemver(current)
  if (kind === 'major') return `${maj + 1}.0.0`
  if (kind === 'minor') return `${maj}.${min + 1}.0`
  if (kind === 'patch') return `${maj}.${min}.${pat + 1}`
  return null
}

// Returns -1, 0, 1 comparing a to b.
function cmpSemver(a, b) {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

function git(args, { capture = true } = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
}

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

// An edit descriptor: rewrite `rel` by applying `transform` to its text.
function makeEdit(rel, transform) {
  const before = read(rel)
  const after = transform(before)
  if (after === before) fail(`No version string matched in ${rel} (already at target?).`)
  return { rel, before, after }
}

function today() {
  // Local date in YYYY-MM-DD. Run on the maintainer's machine, so the local
  // clock is the intended "release date" reference.
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function buildEdits(current, next, date) {
  const edits = []

  // package.json — the canonical version we read `current` from.
  edits.push(
    makeEdit('package.json', (t) => t.replace(/("version":\s*")\d+\.\d+\.\d+(")/, `$1${next}$2`)),
  )

  // tauri/tauri.conf.json
  edits.push(
    makeEdit('tauri/tauri.conf.json', (t) =>
      t.replace(/("version":\s*")\d+\.\d+\.\d+(")/, `$1${next}$2`),
    ),
  )

  // tauri/Cargo.toml — first `version = "..."` is the package version.
  edits.push(
    makeEdit('tauri/Cargo.toml', (t) =>
      t.replace(/^version = "\d+\.\d+\.\d+"/m, `version = "${next}"`),
    ),
  )

  // tauri/Cargo.lock — only the `cotect` package block; other crates may share
  // the same version number, so scope the replace to that block.
  edits.push(
    makeEdit('tauri/Cargo.lock', (t) =>
      t.replace(/(name = "cotect"\nversion = ")\d+\.\d+\.\d+(")/, `$1${next}$2`),
    ),
  )

  // .github/ISSUE_TEMPLATE/bug_report.yml — keep the example placeholder fresh.
  edits.push(
    makeEdit('.github/ISSUE_TEMPLATE/bug_report.yml', (t) =>
      t.replace(/(placeholder:\s*')\d+\.\d+\.\d+(')/, `$1${next}$2`),
    ),
  )

  // CHANGELOG.md — roll [Unreleased] into a dated [next] entry, leaving a fresh
  // empty Unreleased section on top (Keep a Changelog convention).
  edits.push(makeEdit('CHANGELOG.md', (t) => rollChangelog(t, next, date)))

  return edits
}

function rollChangelog(text, next, date) {
  const marker = '## [Unreleased]'
  const idx = text.indexOf(marker)
  if (idx === -1) fail('CHANGELOG.md has no "## [Unreleased]" section to roll.')

  const headEnd = idx + marker.length
  const head = text.slice(0, headEnd) // up to and including the marker line
  let rest = text.slice(headEnd) // everything after the marker

  // Split the Unreleased body from the next section heading.
  const nextHeading = rest.search(/\n## \[/)
  let body
  let tail
  if (nextHeading === -1) {
    body = rest
    tail = ''
  } else {
    body = rest.slice(0, nextHeading)
    tail = rest.slice(nextHeading) // begins with "\n## [..."
  }

  const trimmedBody = body.replace(/^\s+|\s+$/g, '')
  const releasedSection = trimmedBody
    ? `## [${next}] - ${date}\n\n${trimmedBody}\n`
    : `## [${next}] - ${date}\n`

  return `${head}\n\n${releasedSection}${tail.replace(/^\n*/, '\n')}`
}

function diffSummary(edit) {
  // Show only the lines that changed, for a compact preview.
  const b = edit.before.split('\n')
  const a = edit.after.split('\n')
  const changed = []
  const max = Math.max(b.length, a.length)
  for (let i = 0; i < max && changed.length < 8; i++) {
    if (b[i] !== a[i]) {
      if (b[i] !== undefined) changed.push(paint('red', `  - ${b[i]}`))
      if (a[i] !== undefined) changed.push(paint('green', `  + ${a[i]}`))
    }
  }
  return changed.join('\n')
}

function ensureCleanTree() {
  const status = git(['status', '--porcelain']).trim()
  if (status) {
    fail(
      'Working tree is not clean. Commit or stash changes first:\n' +
        status
          .split('\n')
          .map((l) => `    ${l}`)
          .join('\n'),
    )
  }
}

function branchExists(name) {
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])
    return true
  } catch {
    return false
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))

  const pkg = JSON.parse(read('package.json'))
  const current = pkg.version
  if (!SEMVER.test(current)) fail(`package.json version is not X.Y.Z: ${current}`)

  const next = ['major', 'minor', 'patch'].includes(opts.versionArg)
    ? bump(current, opts.versionArg)
    : opts.versionArg
  parseSemver(next) // validate explicit versions

  if (cmpSemver(next, current) <= 0) {
    fail(`New version ${next} is not greater than current ${current}.`)
  }

  const date = opts.date ?? today()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`--date must be YYYY-MM-DD: ${date}`)

  const branch = opts.branch ?? `release/v${next}`

  info('')
  info(`${paint('bold', 'Cotect release')}  ${paint('dim', current)} → ${paint('bold', next)}`)
  info(
    `${paint('dim', 'branch:')} ${branch}   ${paint('dim', 'base:')} ${opts.base}   ${paint('dim', 'date:')} ${date}`,
  )
  info('')

  const edits = buildEdits(current, next, date)

  step('Version strings to update:')
  for (const e of edits) {
    info(`  ${paint('bold', e.rel)}`)
    info(diffSummary(e))
  }
  info('')

  if (opts.dryRun) {
    warn('Dry run — no files written, no branch created.')
    return
  }

  // Git preflight only matters when we are going to create a branch/commit.
  if (opts.commit) {
    ensureCleanTree()
    if (branchExists(branch)) fail(`Branch already exists: ${branch}`)

    step(`Creating branch ${branch} from ${opts.base}`)
    // Cut from the local base branch tip so the bump sits on a known commit.
    git(['switch', '-c', branch, opts.base], { capture: false })
  }

  step('Writing version bumps')
  for (const e of edits) {
    writeFileSync(join(ROOT, e.rel), e.after)
    done(e.rel)
  }

  if (!opts.commit) {
    info('')
    warn('--no-commit: files bumped but not committed. Review and commit manually.')
    return
  }

  step('Committing')
  git(['add', ...edits.map((e) => e.rel)], { capture: false })
  git(['commit', '-m', `chore(release): start v${next}`], { capture: false })
  done(`Committed on ${branch}`)

  if (opts.push) {
    step(`Pushing ${branch} to origin`)
    git(['push', '--set-upstream', 'origin', branch], { capture: false })
    done(`Pushed origin/${branch}`)
  } else {
    warn('--no-push: branch is local only. Push before retargeting PRs onto it.')
  }

  info('')
  done(`Release branch ${paint('bold', branch)} ready for ${paint('bold', next)}.`)
  info('')
  info(paint('dim', 'Next steps:'))
  info(paint('dim', '  • Land upcoming PRs into this branch (retarget their base to it).'))
  info(paint('dim', '  • Fill in CHANGELOG entries under the new version heading.'))
  info(
    paint(
      'dim',
      `  • When ready, merge to ${opts.base} and tag: git tag v${next} && git push origin v${next}`,
    ),
  )
}

main()
