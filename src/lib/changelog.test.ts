import { describe, it, expect } from 'vitest'
import { parseChangelog, sectionForVersion } from './changelog'

const SAMPLE = `# Changelog

All notable changes are documented here.

## [Unreleased]

## [0.4.0] - 2026-06-16

### Added

- In-app changelog viewer.

## [0.3.0] - 2026-06-15

### Fixed

- A scroll bug.

## [0.2.0]

### Added

- Something with no date.
`

describe('parseChangelog', () => {
  it('extracts released versions in file order and skips Unreleased', () => {
    const sections = parseChangelog(SAMPLE)
    expect(sections.map((s) => s.version)).toEqual(['0.4.0', '0.3.0', '0.2.0'])
  })

  it('captures the date when present and null when omitted', () => {
    const sections = parseChangelog(SAMPLE)
    expect(sections[0].date).toBe('2026-06-16')
    expect(sections[2].date).toBeNull()
  })

  it('captures the trimmed body between headings', () => {
    const [latest] = parseChangelog(SAMPLE)
    expect(latest.body).toBe('### Added\n\n- In-app changelog viewer.')
  })

  it('returns an empty array when there are no released sections', () => {
    expect(parseChangelog('# Changelog\n\n## [Unreleased]\n')).toEqual([])
  })
})

describe('sectionForVersion', () => {
  it('returns the exact version match', () => {
    expect(sectionForVersion(SAMPLE, '0.3.0')?.version).toBe('0.3.0')
  })

  it('falls back to the newest section for an unknown version', () => {
    expect(sectionForVersion(SAMPLE, 'dev')?.version).toBe('0.4.0')
  })

  it('returns null when there are no released sections', () => {
    expect(sectionForVersion('## [Unreleased]\n', '0.4.0')).toBeNull()
  })
})
