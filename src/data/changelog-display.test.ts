import { describe, expect, it } from 'vitest'
import changelogData from '@/data/changelog.json'
import type { ChangelogFile } from '@/data/changelog-types'
import {
  formatChangelogCalendarDate,
  getNewestChangelogDateIso,
  getWhatsNewEntries,
} from '@/data/changelog-display'

const data = changelogData as ChangelogFile

describe('changelog-display', () => {
  it('uses the newest changelog.json entry date for What\'s New "as of"', () => {
    const newestIso = getNewestChangelogDateIso(data)
    expect(newestIso).toBe(data.current?.date ?? data.releases[0]?.date)
    const formatted = formatChangelogCalendarDate(newestIso!, 'en-US')
    expect(formatted).toBe(
      formatChangelogCalendarDate(getWhatsNewEntries(data)[0]!.date, 'en-US'),
    )
  })

  it('does not shift ISO calendar dates to the previous local day', () => {
    expect(formatChangelogCalendarDate('2026-10-12', 'en-US')).toBe('Oct 12, 2026')
  })
})
