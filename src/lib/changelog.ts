// Parse CHANGELOG.md (Keep a Changelog format) into per-version sections so the
// app can show the release notes for the running build. The file is bundled raw
// at build time, so this only ever runs over our own changelog.

export interface ChangelogSection {
  version: string
  /** Release date as written in the heading (e.g. "2026-06-16"), or null. */
  date: string | null
  /** Markdown between this version's heading and the next, trimmed. */
  body: string
}

// "## [1.2.3] - 2026-06-16" or "## [1.2.3]" (date optional). The version is
// digits-only, so "## [Unreleased]" never matches and is skipped.
const HEADING = /^##\s+\[(\d+\.\d+\.\d+)\](?:\s*-\s*(.+?))?\s*$/

export function parseChangelog(md: string): ChangelogSection[] {
  const sections: ChangelogSection[] = []
  let current: { version: string; date: string | null; bodyLines: string[] } | null = null

  const flush = () => {
    if (current) {
      sections.push({
        version: current.version,
        date: current.date,
        body: current.bodyLines.join('\n').trim(),
      })
    }
  }

  for (const line of md.split('\n')) {
    const m = HEADING.exec(line)
    if (m) {
      flush()
      current = { version: m[1], date: m[2]?.trim() ?? null, bodyLines: [] }
    } else if (current) {
      current.bodyLines.push(line)
    }
  }
  flush()
  return sections
}

/**
 * The changelog section to show for `version`. An exact version match wins;
 * when the running build has no entry (dev and web builds report "dev"), fall
 * back to the newest released section so there is always something to read.
 * Returns null only when the changelog lists no released versions at all.
 */
export function sectionForVersion(md: string, version: string): ChangelogSection | null {
  const sections = parseChangelog(md)
  if (sections.length === 0) return null
  return sections.find((s) => s.version === version) ?? sections[0]
}
