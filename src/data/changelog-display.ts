import type { ChangelogEntry, ChangelogFile } from '@/data/changelog-types'

/** Changelog JSON stores calendar dates; always display them as that UTC calendar day. */
const CHANGELOG_DISPLAY_TIME_ZONE = 'UTC'

function parseChangelogIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`)
}

export function formatChangelogCalendarDate(iso: string, locale?: string | string[]): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: CHANGELOG_DISPLAY_TIME_ZONE,
  }).format(parseChangelogIsoDate(iso))
}

export function formatChangelogWeekRange(mondayIso: string, locale?: string | string[]): string {
  const monday = parseChangelogIsoDate(mondayIso)
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000)
  const fmt = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: CHANGELOG_DISPLAY_TIME_ZONE,
  })
  return `${fmt.format(monday)} — ${fmt.format(sunday)}`
}

export function getWhatsNewEntries(data: ChangelogFile): ChangelogEntry[] {
  return data.current ? [data.current, ...data.releases] : data.releases
}

/** ISO date (`YYYY-MM-DD`) for the newest entry shown in What's New (matches `changelog.json`). */
export function getNewestChangelogDateIso(data: ChangelogFile): string | undefined {
  return getWhatsNewEntries(data)[0]?.date
}
